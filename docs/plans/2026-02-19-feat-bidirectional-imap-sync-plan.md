---
title: "feat: Bidirectional IMAP sync with IDLE, CONDSTORE, and SSE"
type: feat
date: 2026-02-19
---

# Bidirectional IMAP Sync with Realtime Updates

## Overview

Replace the append-only, poll-based sync with full two-way IMAP synchronization using IDLE for realtime server notifications, CONDSTORE/MODSEQ for efficient flag-change detection, and SSE for pushing updates to the browser.

## Problem Statement

Today Kurir is blind to changes made in other IMAP clients:

- **Flags never update** — `isRead`, `isFlagged`, etc. are set once at initial sync and never refreshed. Reading an email on your phone doesn't mark it read in Kurir.
- **No archive detection** — archiving in Apple Mail leaves the message visible in Kurir's Imbox.
- **No expunge detection** — deleted messages linger in the DB indefinitely.
- **Kurir doesn't push back** — marking a message as read in Kurir doesn't set `\Seen` on the IMAP server. Your phone still shows it unread.
- **5-second poll latency** — even new-message detection relies on React Query polling.

## Proposed Solution

Three phases building on each other:

1. **Phase 1: Foundation + IDLE** — Connection Manager singleton, `highestModSeq` storage, IDLE event handlers, reconnection
2. **Phase 2: Push Layer + SSE** — Kurir → IMAP flag writes, echo suppression, SSE endpoint for browser delivery
3. **Phase 3: Gmail** (deferred — implement only when a Gmail user is confirmed)

## Architectural Constraints

> **Single-process requirement.** The Connection Manager, SSE subscriber map, and echo suppression are all in-process state. They must run in the same Node.js process. This design is correct for self-hosted Docker (this project's deployment model). If horizontal scaling is ever needed, these three become migration targets — extract to a worker process with Redis pub/sub or PostgreSQL LISTEN/NOTIFY.

> **Node.js runtime only.** The Connection Manager cannot be imported from middleware (edge runtime). Initialize via a layout Server Component in `(mail)`.

> **QRESYNC required.** ImapFlow's `expunge` and `flags` events only reliably include UIDs when QRESYNC is enabled (`qresync: true`). Without it, only sequence numbers are returned, which are useless for DB lookups. All ImapFlow client creation must set `qresync: true`.

## Technical Approach

### Architecture

```
Browser                    Next.js Server                    IMAP Server
  │                            │                                │
  │  SSE /api/mail/events      │                                │
  │◄───────────────────────────│  Connection Manager            │
  │                            │  (globalThis singleton)        │
  │                            │    ├── User A                  │
  │                            │    │   └── INBOX idle ─────────┤ IDLE
  │                            │    └── User B                  │
  │                            │        └── INBOX idle ─────────┤ IDLE
  │                            │                                │
  │  POST /api/mail/sync       │                                │
  │───────────────────────────►│  (unchanged: full sync)        │
  │                            │                                │
  │  Server Actions            │                                │
  │───────────────────────────►│  Push Layer                    │
  │                            │  ├── DB update                 │
  │                            │  ├── IMAP flag write ─────────►│ STORE
  │                            │  └── Echo suppression          │
  │                            │                                │
```

---

### Phase 1: Foundation + IDLE

**Goal:** Persistent IMAP connections with IDLE, event handlers, `highestModSeq` storage, CONDSTORE catch-up on reconnect.

#### 1.1 Connection Manager singleton — `src/lib/mail/connection-manager.ts` (new)

A `globalThis`-based singleton (same pattern as Prisma client in Next.js dev). Manages one persistent ImapFlow connection per user on INBOX.

```typescript
// Single-process constraint: ConnectionManager, sseSubscribers, and echo
// suppression must all live in the same Node.js process. See "Architectural
// Constraints" in the plan for details.

const globalForImap = globalThis as unknown as {
  connectionManager: ConnectionManager | undefined;
};

class ConnectionManager {
  private connections: Map<string, UserConnection> = new Map();

  async startUser(userId: string): Promise<void> { /* ... */ }
  async stopUser(userId: string): Promise<void> { /* ... */ }
  async stopAll(): Promise<void> { /* ... */ }
  getClient(userId: string): ImapFlow | null { /* ... */ }
}

export const connectionManager =
  globalForImap.connectionManager ?? new ConnectionManager();

if (process.env.NODE_ENV !== "production") {
  globalForImap.connectionManager = connectionManager;
}
```

**`UserConnection` shape (INBOX-only, no archive connection):**

```typescript
interface UserConnection {
  userId: string;
  client: ImapFlow;
  folderId: string;
  lock: MailboxLockObject | null;
  reconnectTimer: NodeJS.Timeout | null;
  debounceTimers: Map<string, NodeJS.Timeout>;  // cleared in stopUser()
  isGmail: boolean;
}
```

**ImapFlow client creation — must include `qresync: true`:**

```typescript
const client = new ImapFlow({
  host: credentials.imap.host,
  port: credentials.imap.port,
  secure: true,
  auth: { user: credentials.email, pass: credentials.password },
  logger: false,
  qresync: true,  // CRITICAL: enables UID in expunge/flags events
});
```

**Lifecycle:**
- `startUser()` — called from `(mail)/layout.tsx` Server Component on first authenticated render. Creates client, connects, acquires INBOX lock, registers event handlers.
- `stopUser()` — called on logout or `SIGTERM`. Clears all debounce timers, releases lock, calls `client.logout()`.
- `stopAll()` — registered via `process.on("SIGTERM", () => connectionManager.stopAll())`.
- `getClient(userId)` — returns the persistent client for flag pushes (avoids creating new connections).

**Reconnection:** Exponential backoff — 0s, 5s, 15s, 30s, 60s, max 5 minutes. Reset on successful reconnect. On reconnect, run CONDSTORE catch-up (see 1.4).

#### 1.2 Store `highestModSeq` during sync — `src/lib/mail/sync-service.ts`

In `syncMailbox()`, around line 114 where `client.status()` is called:

```typescript
const status = await client.status(mailboxPath, {
  messages: true, uidNext: true, uidValidity: true, highestModseq: true,
});
```

After sync completes, write it to the Folder record:

```typescript
await db.folder.update({
  where: { id: folder.id },
  data: {
    lastSyncedAt: new Date(),
    highestModSeq: status.highestModseq ? BigInt(status.highestModseq) : null,
  },
});
```

#### 1.3 IDLE event handlers — `src/lib/mail/idle-handlers.ts` (new)

All async handlers must be wrapped to prevent unhandled promise rejections (EventEmitter does not await async listeners):

```typescript
function safeAsync<T>(fn: (data: T) => Promise<void>) {
  return (data: T) => {
    fn(data).catch((err) => console.error("[idle] handler error:", err));
  };
}

// In ConnectionManager.startUser(), after acquiring lock:
client.on("exists", safeAsync(async ({ count, prevCount }) => {
  await handleNewMessages(userId, folderId, client);
}));

client.on("expunge", safeAsync(async ({ uid }) => {
  if (!uid) return;  // should not happen with qresync, but guard
  await handleExpunge(userId, folderId, uid);
}));

client.on("flags", safeAsync(async ({ uid, flags, modseq }) => {
  if (!uid) return;
  await handleFlagChange(userId, folderId, uid, flags, modseq);
}));

client.on("close", () => {
  scheduleReconnect(userId);
});
```

**`handleNewMessages`** — on `exists` event:
1. Debounce with 200ms window (batch rapid arrivals).
2. Check `SyncState.isSyncing` — skip if full sync is running.
3. Fetch only UIDs > last known UID for this folder via existing sync logic.
4. Process via `processMessage()`.
5. Emit SSE event to browser.

**`handleExpunge`** — on `expunge` event:
1. Look up message by `(folderId, uid)` in DB. If not found, ignore.
2. Check echo suppression — skip if this is our own change.
3. Set `isDeleted: true` in DB. (Simplification: don't attempt archive-vs-delete disambiguation. The next poll cycle reconciles if the message actually moved to Archive. The worst case is a 30s window where a moved message appears deleted.)
4. Emit SSE event.

**`handleFlagChange`** — on `flags` event:
1. Look up message by `(folderId, uid)` in DB. If not found, ignore.
2. Check echo suppression — skip if this is our own change.
3. Map IMAP flags to DB fields:
   - `\Seen` → `isRead`, `\Flagged` → `isFlagged`, `\Answered` → `isAnswered`, `\Deleted` → `isDeleted`, `\Draft` → `isDraft`
4. Compare with current DB values. Update only changed fields using Prisma's typed `MessageUpdateInput`.
5. If any change, emit SSE event.
6. If `modseq` is present and higher than stored `Folder.highestModSeq`, update it.

**Event debouncing:**
- `exists` events: 200ms debounce window. Clear timer in `stopUser()`.
- `flags` and `expunge`: process individually (they carry specific UID data).

#### 1.4 CONDSTORE catch-up on reconnect

When the Connection Manager reconnects after a disconnection:

```typescript
async function catchUpAfterReconnect(
  client: ImapFlow, userId: string, folderId: string
): Promise<void> {
  const folder = await db.folder.findUnique({ where: { id: folderId } });
  if (!folder?.highestModSeq) return;  // no stored modseq, skip

  // Fetch only messages changed since last known modseq
  let maxModSeq = folder.highestModSeq;
  for await (const msg of client.fetch("1:*", {
    uid: true, flags: true, changedSince: folder.highestModSeq,
  })) {
    await updateMessageFlags(userId, folderId, msg.uid, msg.flags);
    // Track max modseq from fetch responses (not from a separate STATUS call)
    if (msg.modseq && msg.modseq > maxModSeq) {
      maxModSeq = msg.modseq;
    }
  }

  if (maxModSeq > folder.highestModSeq) {
    await db.folder.update({
      where: { id: folderId },
      data: { highestModSeq: maxModSeq },
    });
  }
}
```

**Note:** `highestModSeq` is derived from `max(msg.modseq)` across fetch responses, NOT from a subsequent `STATUS` call. This avoids a TOCTOU gap where new changes arrive between the fetch and the status call.

If `highestModSeq` is null (never stored), the catch-up is skipped — the next full poll sync handles it.

#### Files changed — Phase 1

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/mail/connection-manager.ts` | Create | Singleton, lifecycle, reconnect, `getClient()` |
| `src/lib/mail/idle-handlers.ts` | Create | Event handlers with `safeAsync` wrapper |
| `src/lib/mail/sync-service.ts` | Edit | Store `highestModSeq` in status call |

---

### Phase 2: Push Layer + SSE

**Goal:** Kurir actions push flags to IMAP server. SSE delivers realtime updates to browser.

#### 2.1 Flag push helper + echo suppression — `src/lib/mail/flag-push.ts` (new)

Prefer the ConnectionManager's persistent client; fall back to `withImapConnection` if not available.

```typescript
// Inline echo suppression — plain Set + setTimeout (no separate file)
const pendingEchoes = new Set<string>();

export function suppressEcho(userId: string, folderId: string, uid: number): void {
  const key = `${userId}:${folderId}:${uid}`;
  pendingEchoes.add(key);
  setTimeout(() => pendingEchoes.delete(key), 10_000);
}

export function isEcho(userId: string, folderId: string, uid: number): boolean {
  const key = `${userId}:${folderId}:${uid}`;
  return pendingEchoes.delete(key);  // returns true if was present
}

export async function pushFlagsToImap(
  userId: string,
  messages: Array<{ uid: number; folderId: string }>,
  flag: string,
  action: "add" | "remove",
): Promise<void> {
  const imapMessages = messages.filter(m => m.uid > 0);  // skip local placeholders
  if (imapMessages.length === 0) return;

  // Register echo suppression before push
  for (const msg of imapMessages) {
    suppressEcho(userId, msg.folderId, msg.uid);
  }

  // Prefer persistent connection from ConnectionManager
  const persistentClient = connectionManager.getClient(userId);

  if (persistentClient) {
    // Use persistent connection — no connect/logout overhead
    for (const msg of imapMessages) {
      const folder = await db.folder.findUnique({ where: { id: msg.folderId } });
      if (!folder) continue;
      const lock = await persistentClient.getMailboxLock(folder.path);
      try {
        if (action === "add") {
          await persistentClient.messageFlagsAdd(String(msg.uid), [flag], { uid: true });
        } else {
          await persistentClient.messageFlagsRemove(String(msg.uid), [flag], { uid: true });
        }
      } finally {
        lock.release();
      }
    }
  } else {
    // Fallback: ephemeral connection
    await withImapConnection(userId, async (client) => { /* same logic */ });
  }
}
```

**Note:** Flag push uses individual UIDs (not comma-separated) per the known ImapFlow gotcha documented in CLAUDE.md and project memory.

#### 2.2 Push `\Seen` — extract from `getThreadMessages()`

**All reviewers agreed:** `getThreadMessages()` is a data-fetching function — adding IMAP side effects there is wrong. Instead, the `\Seen` push should be triggered from the call site.

The thread page Server Components at `src/app/(mail)/imbox/[id]/page.tsx` (and `feed/[id]`, `paper-trail/[id]`, `archive/[id]`) call `getThreadMessages()`. After that call, add the IMAP push:

```typescript
// In each thread page.tsx:
const messages = await getThreadMessages(messageId, userId);

// Push \Seen to IMAP for messages that were just marked read (fire-and-forget)
const justMarkedRead = messages.filter(m => /* newly marked */);
if (justMarkedRead.length > 0) {
  pushFlagsToImap(userId, justMarkedRead, "\\Seen", "add").catch(console.error);
}
```

Alternatively, extract a `markThreadAsRead` server action and call it from a client component on mount. Either approach keeps `threads.ts` as a pure data layer.

#### 2.3 Echo suppression for `archiveConversation()`

In `src/actions/archive.ts`, before the existing `messageMove` call:

```typescript
for (const uid of inboxMessageUids) {
  suppressEcho(userId, inboxFolderId, uid);
}
// ... existing messageMove or label removal
```

#### 2.4 SSE subscriber map — module-scoped (no EventBus class)

```typescript
// src/lib/mail/sse-subscribers.ts (new)
// Single-process constraint: must be in same process as ConnectionManager.

export type MailEvent =
  | { type: "new-messages"; data: { folderId: string; count: number } }
  | { type: "flags-changed"; data: { messageId: string; flags: Record<string, boolean> } }
  | { type: "message-deleted"; data: { messageId: string } };

type EventCallback = (event: MailEvent) => void;

export const sseSubscribers = new Map<string, Set<EventCallback>>();

export function emitToUser(userId: string, event: MailEvent): void {
  const subscribers = sseSubscribers.get(userId);
  if (!subscribers) return;
  for (const cb of subscribers) {
    cb(event);
  }
}
```

IDLE handlers import `emitToUser` directly. No class needed.

#### 2.5 SSE endpoint — `src/app/api/mail/events/route.ts` (new)

```typescript
export const runtime = "nodejs";  // not edge — needs access to sseSubscribers

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: MailEvent) => {
        controller.enqueue(encoder.encode(
          `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`
        ));
      };

      // Register subscriber
      if (!sseSubscribers.has(userId)) {
        sseSubscribers.set(userId, new Set());
      }
      const subscribers = sseSubscribers.get(userId)!;
      subscribers.add(send);

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 30_000);

      // Cleanup on disconnect
      request.signal.addEventListener("abort", () => {
        subscribers.delete(send);
        if (subscribers.size === 0) sseSubscribers.delete(userId);
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

#### 2.6 SSE integration in AutoSync — `src/components/mail/auto-sync.tsx`

Inline the EventSource directly (no separate hook file — single use):

```typescript
// Stable ref to avoid reconnect on every render
const routerRef = useRef(router);
useLayoutEffect(() => { routerRef.current = router; });

useEffect(() => {
  const es = new EventSource("/api/mail/events");

  const handleEvent = () => routerRef.current.refresh();
  es.addEventListener("new-messages", handleEvent);
  es.addEventListener("flags-changed", handleEvent);
  es.addEventListener("message-deleted", handleEvent);

  es.onerror = () => console.warn("[sse] reconnecting...");

  return () => es.close();
}, []);  // stable — no dependency on router
```

Increase React Query poll fallback from 5s to 30s (SSE handles the realtime path).

#### Files changed — Phase 2

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/mail/flag-push.ts` | Create | Flag push + inline echo suppression |
| `src/lib/mail/sse-subscribers.ts` | Create | Module-scoped SSE subscriber Map + `emitToUser` |
| `src/app/api/mail/events/route.ts` | Create | SSE endpoint |
| `src/app/(mail)/imbox/[id]/page.tsx` | Edit | Push `\Seen` after thread load |
| `src/app/(mail)/feed/[id]/page.tsx` | Edit | Push `\Seen` after thread load |
| `src/app/(mail)/paper-trail/[id]/page.tsx` | Edit | Push `\Seen` after thread load |
| `src/app/(mail)/archive/[id]/page.tsx` | Edit | Push `\Seen` after thread load |
| `src/actions/archive.ts` | Edit | Add echo suppression before IMAP move |
| `src/components/mail/auto-sync.tsx` | Edit | Inline SSE + increase poll to 30s |

---

### Phase 3: Gmail Support (Deferred)

**Implement only when a Gmail user is confirmed.** Gmail's IMAP is architecturally different (labels vs folders, no EXPUNGE on archive, 15-connection limit). Standard IMAP flag sync (`\Seen`, `\Flagged`, `\Deleted`) works identically on Gmail — only archive detection differs.

When needed:

1. **Gmail detection:** Check `credentials.imap.host.includes("gmail.com")`, store `isGmail` on `UserConnection`.
2. **Gmail archive action:** In `archiveConversation()`, use `messageFlagsRemove(uid, ["\\Inbox"], { uid: true })` instead of `messageMove`.
3. **Gmail archive detection:** In `handleFlagChange`, fetch `X-GM-LABELS` and detect `\Inbox` label removal.
4. **Connection limit:** IDLE on INBOX only (already the default).

This is ~30 lines of branching logic, not a separate file.

---

## Implementation Checklist

### Phase 1: Foundation + IDLE
- [x] 1. Create `src/lib/mail/connection-manager.ts` — `globalThis` singleton, INBOX-only, `getClient()`, `stopAll()` on SIGTERM
- [x] 2. Store `highestModSeq` in `syncMailbox()` status call
- [x] 3. Create `src/lib/mail/idle-handlers.ts` — `safeAsync` wrapper + `handleNewMessages` (200ms debounce)
- [x] 4. Implement `handleExpunge` — set `isDeleted: true` (no archive disambiguation)
- [x] 5. Implement `handleFlagChange` — map flags to DB, update `highestModSeq`
- [x] 6. Implement reconnection with exponential backoff + CONDSTORE catch-up inline
- [x] 7. Initialize ConnectionManager from `(mail)/layout.tsx` Server Component

### Phase 2: Push Layer + SSE
- [x] 8. Create `src/lib/mail/flag-push.ts` — flag push with inline echo suppression (Set + setTimeout)
- [x] 9. Push `\Seen` from thread page Server Components (not `getThreadMessages`)
- [x] 10. Add echo suppression to `archiveConversation()` in `archive.ts`
- [x] 11. Create `src/lib/mail/sse-subscribers.ts` — module-scoped Map + `emitToUser()`
- [x] 12. Create SSE endpoint `src/app/api/mail/events/route.ts`
- [x] 13. Integrate SSE inline in `auto-sync.tsx` (useRef for stable callback), increase poll to 30s

### Phase 3: Gmail (when needed)
- [ ] 14. Gmail detection from IMAP host, store on UserConnection
- [ ] 15. Gmail archive via label removal in `archive.ts`

## Acceptance Criteria

### Flag Sync (IMAP → Kurir)
- [ ] Reading a message on phone marks it read in Kurir within seconds
- [ ] Flagging a message on phone marks it flagged in Kurir
- [ ] Deleting a message on phone removes it from Kurir

### Flag Sync (Kurir → IMAP)
- [ ] Opening a thread in Kurir sets `\Seen` on the IMAP server
- [ ] Archiving in Kurir moves message on IMAP server

### Realtime Updates
- [ ] New messages appear in Kurir within 2s of IMAP delivery (via IDLE + SSE)
- [ ] Flag changes appear within 2s
- [ ] SSE auto-reconnects on connection drop
- [ ] React Query poll continues as 30s fallback

### CONDSTORE
- [ ] `Folder.highestModSeq` is stored after every sync
- [ ] After reconnect, only changed flags are fetched (not full mailbox scan)

### Connection Management
- [ ] Persistent connections survive indefinitely (auto-IDLE cycling)
- [ ] Reconnection with exponential backoff on connection drop
- [ ] Graceful shutdown on `SIGTERM`
- [ ] No connection leaks during Next.js dev hot reload (`globalThis` pattern)

### Echo Suppression
- [ ] Kurir-initiated changes are not re-processed from IDLE
- [ ] Redundant DB updates from missed suppressions are harmless (idempotent)

## Edge Cases

- **Negative UID (local placeholder)**: Skipped for IMAP flag push — only positive UIDs get `STORE`
- **UIDVALIDITY change**: Existing logic in `syncMailbox()` handles this (full folder wipe + resync)
- **IMAP server drops IDLE**: ImapFlow auto-cycles IDLE. Reconnect handler catches `close` events.
- **Import running while IDLE fires**: IDLE handler checks `SyncState.isSyncing` and skips
- **Process restart with in-flight echo suppression**: Lost, but worst case is a redundant idempotent DB update
- **Message UID changes after move**: Reconciled via `messageId` dedup in `processMessage()`
- **`expunge` without UID (no QRESYNC)**: Guarded with `if (!uid) return` — should not happen with `qresync: true`
- **Multi-tab SSE**: Each tab opens its own EventSource; all receive events via sseSubscribers Map
- **Stale SSE session after logout**: SSE validates auth once on connect; session expiry handled by next poll or browser close

## Risk Analysis

| Risk | Impact | Mitigation |
|------|--------|------------|
| IMAP server rate-limits persistent connections | Connection dropped, missed events | Exponential backoff, poll fallback at 30s |
| Multi-process deployment breaks in-process state | Missed events, echo failures | Document single-process constraint; Docker Compose is single-process |
| `globalThis` pattern fails in edge runtime | No persistent connections | Explicit `runtime = "nodejs"` on SSE route; init from layout, not middleware |
| SSE connections accumulate without cleanup | Memory leak | AbortSignal cleanup, heartbeat timeout |
| Hot reload connection leak in dev | Orphaned IMAP connections | `globalThis` preserves singleton across HMR |

## Dependencies

- **ImapFlow ^1.0.171** — already installed, supports IDLE + CONDSTORE + QRESYNC
- **No new npm packages required** — SSE is native Web API, EventSource is built into browsers
- **Prisma schema** — `Folder.highestModSeq` already exists, no migration needed
- **Node.js runtime** — Connection Manager cannot run in edge runtime

## Review Feedback Applied

- **Kieran (TypeScript):** Added `qresync: true` to all client creation. Wrapped async handlers with `safeAsync`. Typed `MailEvent` as discriminated union. Used `useRef` for stable SSE callback. Flag push uses persistent client via `getClient()`.
- **Architecture Strategist:** Moved echo suppression before IDLE handlers. Documented single-process constraint. `deltaSync` uses `max(msg.modseq)` from fetch response, not `STATUS`. Moved `\Seen` push out of `getThreadMessages()` to page-level call sites.
- **Simplicity Reviewer:** Cut from 29 to 15 steps. Removed fullFlagReconciliation (CONDSTORE is universal). Merged Phases 2+3 into Phase 1. Killed EventBus class → module-scoped Map. Killed use-mail-events.ts → inline in AutoSync. Simplified echo suppression to Set + setTimeout. Dropped archive-vs-delete disambiguation. INBOX-only IDLE. Deferred Gmail. Dropped `\Answered` push.

## References

- Brainstorm: `docs/brainstorms/2026-02-19-bidirectional-imap-sync-brainstorm.md`
- ImapFlow IDLE events: [DeepWiki](https://deepwiki.com/postalsys/imapflow/5.3-real-time-updates-with-idle)
- ImapFlow CONDSTORE: [DeepWiki](https://deepwiki.com/postalsys/imapflow/5-message-operations)
- Current sync engine: `src/lib/mail/sync-service.ts`
- IMAP client helper: `src/lib/mail/imap-client.ts`
- Archive action: `src/actions/archive.ts`
- Thread mark-as-read: `src/lib/mail/threads.ts:144-151`
- Auto-sync polling: `src/components/mail/auto-sync.tsx`
- Sync API route: `src/app/api/mail/sync/route.ts`
- Prisma schema: `prisma/schema.prisma` (Folder.highestModSeq at line ~128)
