---
title: "feat: Full Mailbox Import"
type: feat
date: 2026-02-16
---

# Full Mailbox Import

## Overview

Import all existing emails from an IMAP account (Inbox + Sent), not just messages arriving after account connection. The current sync already computes UID deltas correctly but processes everything in a single HTTP request, which silently fails for large mailboxes (5k-50k messages).

The fix: make `syncMailbox` batch-aware, add a concurrency guard, and give `AutoSync` a progress bar mode.

## Problem Statement

When a user connects their IMAP account, only messages that arrive _after_ connection are imported. The sync appears to complete (returns JSON) but processes zero historical messages because the request times out on large mailboxes.

## Proposed Solution

Add a `batchSize` parameter to the existing sync. Same endpoint, same code path. When `remaining > 0`, the client keeps calling and shows progress. ~90 lines of new/changed code across 4 files.

## Technical Approach

### Step 1: Make `syncMailbox` Batch-Aware

Modify `syncMailbox()` in `src/lib/mail/sync-service.ts` to accept an optional `batchSize`.

**Batching strategy:** The existing UID discovery is correct and cheap — `client.search({ all: true })` returns an array of integers (~200KB for 50k UIDs). Keep it. The expensive part is `client.fetch()` with `source: true` that downloads full message bodies. Batch _that_.

```typescript
// After computing newUids (line 162):
const batch = batchSize ? newUids.slice(0, batchSize) : newUids;
const batchSet = new Set(batch);
const minUid = Math.min(...batch);
const fetchRange = `${minUid}:*`;

for await (const msg of client.fetch(fetchRange, { ... })) {
  if (!batchSet.has(Number(msg.uid))) continue;
  await processMessage(...);
}
```

**Return progress stats** by extending `SyncResult`:

```typescript
interface SyncResult {
  folderId: string;
  newMessages: number;
  errors: string[];
  remaining: number; // newUids.length - batch.length
  totalOnServer: number; // allUids.length
  totalCached: number; // existingUids.size
}
```

**Skip `repairThreadIds()` when `remaining > 0`.** The inline threading in `processMessage()` handles new messages. Run `repairThreadIds` only on the final batch (when all folders have `remaining === 0`).

**File:** `src/lib/mail/sync-service.ts`

### Step 2: Add Concurrency Guard to Sync Route

Modify `src/app/api/mail/sync/route.ts` to prevent concurrent IMAP connections.

**Atomic lock using `SyncState`** (model already exists in schema, currently unused):

```typescript
// Atomic claim — no race condition
const claimed = await db.syncState.updateMany({
  where: {
    userId,
    OR: [
      { isSyncing: false },
      // Auto-recover stale locks (crash recovery)
      { syncStartedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } },
    ],
  },
  data: { isSyncing: true, syncStartedAt: new Date() },
});

if (claimed.count === 0) {
  // Already running — return current progress for the polling client
  return NextResponse.json({ success: true, results: [], importing: true });
}
```

Release lock in a `finally` block after sync completes.

**Accept `batchSize` from query param:**

```
POST /api/mail/sync?batchSize=200
```

When AutoSync calls without `batchSize`, the existing behavior is preserved (process all new messages — which is fine for small deltas). When the import UI calls with `batchSize=200`, it processes one batch and returns progress.

**Schema change:** Add `syncStartedAt` to `SyncState` and a `User` relation for cascading deletes:

```prisma
model SyncState {
  id     String @id @default(cuid())
  userId String @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  lastFullSync   DateTime?
  isSyncing      Boolean   @default(false)
  syncStartedAt  DateTime?
  syncError      String?

  @@index([userId])
}
```

Note: `totalMessages`/`processedMessages` are NOT persisted — they're computed from the UID delta on each call and returned in the response. The client tracks progress ephemerally.

**File:** `src/app/api/mail/sync/route.ts`, `prisma/schema.prisma`

### Step 3: Enhance AutoSync with Progress UI

Modify `src/components/mail/auto-sync.tsx` to show a progress bar when `remaining > 0`.

**Two visual modes:**

- **Invisible (steady-state):** Current behavior. Polls every 5s, renders `null`.
- **Importing (progress):** When response includes `remaining > 0`, show progress bar, increase poll frequency, pass `batchSize=200` on subsequent calls.

```typescript
// Pseudocode for the enhanced AutoSync
const [importing, setImporting] = useState(false);

const { data } = useQuery({
  queryKey: ["mail-sync"],
  queryFn: async () => {
    const url = importing
      ? "/api/mail/sync?batchSize=200"
      : "/api/mail/sync";
    const res = await fetch(url, { method: "POST" });
    return res.json();
  },
  refetchInterval: importing ? 1000 : 5000,  // faster during import
});

// When response has remaining > 0, enter import mode
useEffect(() => {
  if (data?.results?.some(r => r.remaining > 0)) {
    setImporting(true);
  } else if (importing && data?.results?.every(r => r.remaining === 0)) {
    setImporting(false);
  }
}, [data]);

// Render progress bar when importing, null otherwise
if (!importing) return null;
const synced = data.results.reduce((s, r) => s + r.totalCached, 0);
const total = data.results.reduce((s, r) => s + r.totalOnServer, 0);
return <ProgressBar synced={synced} total={total} />;
```

Progress bar is a simple `div` with width percentage — no new dependency.

Skip `router.refresh()` when `data.importing === true` (AutoSync guard hit) to avoid unnecessary RSC re-renders during import.

**File:** `src/components/mail/auto-sync.tsx`

### Step 4: Settings Page — Import Button

Replace the "Sync Now" form in `src/app/(mail)/settings/page.tsx` (line 92-106) with an "Import All Messages" button that triggers import mode.

The button calls `POST /api/mail/sync?batchSize=200` once — this kicks off the first batch. AutoSync (already mounted in the layout) detects `remaining > 0` in the response and automatically enters import mode with the progress bar.

Alternatively, the button can set a shared state (via React context or URL param) that tells AutoSync to start in import mode.

**File:** `src/app/(mail)/settings/page.tsx`

## Acceptance Criteria

- [x] Import processes messages in batches (~200/call), not all at once
- [x] Progress bar shows `synced / total` count during import
- [x] AutoSync pauses regular polling during import (concurrency guard)
- [x] Settings page has "Import All Messages" button
- [x] `repairThreadIds` runs once at import completion, not per-batch
- [x] Concurrent requests are prevented (atomic lock with stale recovery)

## Edge Cases

| Case                            | Handling                                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UIDVALIDITY changes mid-import  | Existing code at line 136-146 handles this — deletes folder messages, restarts. Progress resets naturally.                                                                  |
| IMAP connection drops mid-batch | Messages 1..N already persisted individually. Next batch picks up remaining UIDs. Client retries automatically.                                                             |
| Server crash / stale lock       | `syncStartedAt` auto-expires after 5 minutes. Next request reclaims the lock.                                                                                               |
| User navigates away mid-import  | Partial data kept. AutoSync detects remaining > 0 on next page load and resumes.                                                                                            |
| All messages already synced     | First batch returns `remaining: 0`. AutoSync stays invisible. No special UI state needed.                                                                                   |
| IMAP rate limiting (Gmail)      | Each batch opens a new TLS connection. The ~2-5s processing time per batch acts as natural throttle. If rate-limited, IMAP error is caught and client retries on next poll. |
| Non-contiguous UIDs             | UID search returns all UIDs regardless of gaps. Batching slices the newUids array, not the UID range.                                                                       |

## Files Changed

| File                                | Change                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/mail/sync-service.ts`      | Add `batchSize` option to `syncMailbox()` and `syncUserEmail()`. Slice `newUids`. Return `remaining`/`totalOnServer`/`totalCached`. Skip `repairThreadIds` when remaining > 0. |
| `src/app/api/mail/sync/route.ts`    | Accept `batchSize` query param. Add atomic `SyncState.isSyncing` guard with stale lock recovery.                                                                               |
| `src/components/mail/auto-sync.tsx` | Two-mode component: invisible (steady-state) and visible (importing with progress bar).                                                                                        |
| `src/app/(mail)/settings/page.tsx`  | Replace "Sync Now" form with "Import All Messages" button.                                                                                                                     |
| `prisma/schema.prisma`              | Add `syncStartedAt DateTime?` and `User` relation to `SyncState`.                                                                                                              |

## References

- **Brainstorm:** `docs/brainstorms/2026-02-16-full-mailbox-import-brainstorm.md`
- **Sync service:** `src/lib/mail/sync-service.ts` — `syncMailbox()` (line 87), `syncUserEmail()` (line 480)
- **AutoSync:** `src/components/mail/auto-sync.tsx`
- **Settings page:** `src/app/(mail)/settings/page.tsx` (Sync section: line 92-106)
- **SyncState model:** `prisma/schema.prisma` (line 244-260)
- **Known issue:** ImapFlow comma-separated UID bug — use range format `minUid:*` and filter in loop
