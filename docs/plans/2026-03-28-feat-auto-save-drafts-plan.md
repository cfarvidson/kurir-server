title: Auto-Save Drafts for Email Composition
type: feat
date: 2026-03-28

## Enhancement Summary

**Deepened on:** 2026-03-28
**Sections enhanced:** 6
**Research agents used:** kieran-typescript-reviewer, performance-oracle, security-sentinel, architecture-strategist, julik-frontend-races-reviewer, code-simplicity-reviewer, data-integrity-guardian, pattern-recognition-specialist, Context7 (Zustand, Prisma)

### Key Improvements
1. **Fixed NULL unique constraint bug** — PostgreSQL treats NULL as distinct in unique constraints; switched `contextMessageId` to non-null with sentinel value `"__new__"` for NEW drafts
2. **Simplified to single debounce** — localStorage write is synchronous inside the 2s debounce callback (no separate 300ms timer needed)
3. **Added Zustand `partialize`** — only persist draft data to localStorage, not status/timers
4. **Security: draft body encryption** — match ScheduledMessage pattern for server-side body encryption
5. **Race condition mitigations** — AbortController for server saves, ref-based latest value tracking
6. **Attachment ownership validation** — server action must verify attachmentIds belong to the current user

### Institutional Learnings Applied
- From `sent-messages-missing-from-thread-views.md`: shared persistence helper pattern, plan reconciliation at design time
- From `auto-archive-rejected-screener-messages.md`: use `after()` for deferred ops, parallelize with `Promise.all()`, don't create modules for 2 consumers

# Auto-Save Drafts for Email Composition

## Overview

Add automatic draft saving to all compose contexts (new compose, reply, forward). Drafts are saved locally (localStorage) for instant crash recovery and synced to the server (PostgreSQL via Prisma) for cross-session persistence. Auto-save triggers on a debounced keystroke (~2s after typing stops). A status indicator shows save state.

## Problem Statement / Motivation

Currently, if a user navigates away from a compose surface or the browser crashes, all composed content is lost. The only protection is `useBeforeUnload` on the full-page compose — and only when pending sends exist. This is a significant UX gap for an email client.

## Proposed Solution

**Local-first, server-synced single-debounce architecture:**

1. **Single 2s debounce** — on keystroke change, wait 2s, then write to both localStorage (sync) and server (async)
2. **Crash recovery** — `beforeunload` + `useEffect` cleanup flush latest content to localStorage
3. **Restoration** — on mount, check localStorage first (sync), fall back to server if empty (async)
4. **Cleanup** — delete draft on successful send (after undo window), schedule-send, or explicit discard

## Technical Approach

### Data Model

New `Draft` Prisma model:

```prisma
// prisma/schema.prisma

model Draft {
  id                String   @id @default(cuid())
  userId            String
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  type              DraftType        // NEW, REPLY, FORWARD
  contextMessageId  String   @default("__new__") // messageId for REPLY/FORWARD, "__new__" for NEW
  emailConnectionId String?          // selected "from" connection (not a FK — graceful fallback if deleted)
  to                String   @default("")
  subject           String   @default("")
  body              String   @default("")  @db.Text
  attachmentIds     String[] @default([])

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([userId, type, contextMessageId])
  @@index([userId])
}

enum DraftType {
  NEW
  REPLY
  FORWARD
}
```

The `@@unique([userId, type, contextMessageId])` constraint ensures one draft per compose context.

### Research Insights: Data Model

**Critical: NULL in PostgreSQL unique constraints.**
PostgreSQL treats NULL values as **distinct** in unique constraints. If `contextMessageId` were nullable, multiple `NEW` drafts per user would be allowed (each NULL is considered unique). Fix: use `"__new__"` as a sentinel value instead of null. This makes the compound unique constraint work correctly for all draft types.

**emailConnectionId is NOT a foreign key by design.** If a user deletes an email connection while a draft references it, the draft should gracefully fall back to the user's default connection on restoration — not cascade-delete or throw. The `FromPicker` component already handles "connection not found" by selecting the default.

**attachmentIds as `String[]` (not FK).** Attachment records are already independently managed by the upload system. Draft just stores references. On restoration, verify each attachment still exists before displaying. No FK enforcement needed — matches the existing `ScheduledMessage.attachmentIds` pattern.

**body field: consider encryption.** The existing `ScheduledMessage` model encrypts body content at rest. Draft bodies contain potentially sensitive email content. For consistency, use the same encryption pattern (`encryptForUser`/`decryptForUser` from scheduled-messages). Added to Phase 1 implementation.

### localStorage Schema

Keys: `kurir:draft:{userId}:{type}:{contextId}`

Examples:
- `kurir:draft:abc123:new:__new__` (new compose)
- `kurir:draft:abc123:reply:msg456` (reply to message msg456)
- `kurir:draft:abc123:forward:msg789` (forward of message msg789)

Value: JSON-serialized `DraftData`:

```typescript
interface DraftData {
  to: string;
  subject: string;
  body: string;
  emailConnectionId?: string;
  attachmentIds: string[];
  updatedAt: number; // Date.now() timestamp
}
```

### Research Insights: localStorage

**localStorage is synchronous and blocking.** `JSON.stringify` + `setItem` runs on the main thread. For typical email bodies (<50KB), this takes <1ms. For very large emails with inline images (markdown `![](...)` references, not binary), serialization could reach 5-10ms. Mitigations:
- The debounce ensures this only fires every 2s, not on every keystroke
- `JSON.stringify` of a flat object with string fields is fast — no deep nesting

**localStorage 5-10MB per-origin limit.** Each draft is ~1-50KB (text only, no binary). At 50KB per draft, you'd need 100+ drafts to hit the limit. Safe for this use case. If `setItem` throws `QuotaExceededError`, catch it silently and rely on server sync alone.

**User scoping via key prefix.** The `{userId}` in the key prevents cross-user draft leakage on shared devices. This is consistent with how the codebase already scopes localStorage keys (screener hint uses a global key, but it's non-sensitive).

### Architecture

```
┌─────────────────┐     onChange (2s debounce)      ┌──────────────┐
│  Compose UI     │ ───────────────────────────────▶│ saveDraft()  │
│  (textarea)     │                                  │ in useDraft  │
└─────────────────┘                                  └──────┬───────┘
                                                            │
                                            ┌───────────────┼───────────────┐
                                            ▼               ▼               │
                                     ┌──────────┐   ┌──────────────┐       │
                                     │localStorage│   │ Server Action│       │
                                     │ (sync,    │   │ saveDraft()  │       │
                                     │  instant) │   │ (async)      │       │
                                     └──────────┘   └──────┬───────┘       │
                                                           ▼               │
                                                    ┌──────────────┐       │
                                                    │  Prisma DB   │       │
                                                    │  Draft model │       │
                                                    └──────────────┘       │
                                                                           │
                                                    ┌──────────────┐       │
                                                    │  Status      │◀──────┘
                                                    │  indicator   │
                                                    └──────────────┘
```

### Research Insights: Architecture (Simplified)

**Single debounce, dual write.** The original plan had two separate debounce timers (300ms for localStorage, 2s for server). This is unnecessary complexity. **Simplified approach:** one 2s debounce that writes to localStorage synchronously (instant, ~<1ms) then fires the async server action. localStorage acts as crash recovery during the 2s debounce window. If the user closes the tab mid-typing, `beforeunload` flushes the latest content to localStorage synchronously.

**Why not Zustand `persist` middleware?** The existing `pendingSendStore` doesn't use it, and our draft store has different requirements: we need per-draft keys (not a single store key), we need manual control over when localStorage writes happen, and we need to coordinate with server sync. Manual `localStorage.setItem` in the save function is simpler and more explicit.

**Server actions vs API routes.** Server actions are the right choice (matching existing patterns). They're simpler, don't need a separate route file, and support the same auth pattern. The `saveDraft` action will be called frequently (every 2s while typing) but each call is a simple upsert — no performance concern.

**AbortController for in-flight saves.** When a new save fires while a previous server action is still in-flight, the previous one should be aborted. Use `AbortController` to cancel stale requests. This prevents race conditions where an older save completes after a newer one.

### Implementation Phases

#### Phase 1: Data Model + Server Actions

**Files to create/modify:**

- `prisma/schema.prisma` — Add `Draft` model and `DraftType` enum
- `src/actions/drafts.ts` — Server actions: `saveDraft`, `getDraft`, `deleteDraft`, `getUserDrafts`
- Run `pnpm db:push` and `pnpm db:generate`

Server action pattern (following existing conventions):

```typescript
// src/actions/drafts.ts
"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { DraftType } from "@prisma/client";

export async function saveDraft(data: {
  type: DraftType;
  contextMessageId: string; // "__new__" for NEW type
  to?: string;
  subject?: string;
  body?: string;
  emailConnectionId?: string;
  attachmentIds?: string[];
}) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  // Validate attachmentIds belong to this user (security)
  if (data.attachmentIds?.length) {
    const owned = await db.attachment.count({
      where: { id: { in: data.attachmentIds }, userId },
    });
    if (owned !== data.attachmentIds.length) {
      throw new Error("Invalid attachment references");
    }
  }

  // Upsert by compound unique [userId, type, contextMessageId]
  return db.draft.upsert({
    where: {
      userId_type_contextMessageId: {
        userId,
        type: data.type,
        contextMessageId: data.contextMessageId,
      },
    },
    update: {
      to: data.to ?? "",
      subject: data.subject ?? "",
      body: data.body ?? "", // TODO: encrypt like ScheduledMessage
      emailConnectionId: data.emailConnectionId,
      attachmentIds: data.attachmentIds ?? [],
    },
    create: {
      userId,
      type: data.type,
      contextMessageId: data.contextMessageId,
      to: data.to ?? "",
      subject: data.subject ?? "",
      body: data.body ?? "",
      emailConnectionId: data.emailConnectionId,
      attachmentIds: data.attachmentIds ?? [],
    },
  });
}

export async function deleteDraft(
  type: DraftType,
  contextMessageId: string,
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Delete by compound unique — no separate ownership check needed
  // because userId is part of the unique constraint
  await db.draft.deleteMany({
    where: {
      userId: session.user.id,
      type,
      contextMessageId,
    },
  });
}

export async function getDraft(
  type: DraftType,
  contextMessageId: string,
) {
  const session = await auth();
  if (!session?.user?.id) return null;

  return db.draft.findUnique({
    where: {
      userId_type_contextMessageId: {
        userId: session.user.id,
        type,
        contextMessageId,
      },
    },
  });
}

export async function getUserDrafts() {
  const session = await auth();
  if (!session?.user?.id) return [];

  return db.draft.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
  });
}
```

### Research Insights: Server Actions

**Security: validate attachmentIds ownership.** The `saveDraft` action must verify that all `attachmentIds` belong to the current user. Without this check, a malicious client could associate another user's attachments with their draft. Added `db.attachment.count()` validation.

**Use compound unique for deleteDraft (not draft ID).** Deleting by `[userId, type, contextMessageId]` is safer than by ID because it inherently includes the userId check. No separate ownership verification needed. Uses `deleteMany` to avoid throwing if draft doesn't exist.

**Pattern: match existing server actions.** The action signatures match `src/actions/scheduled-messages.ts`: `auth()` check first, Prisma operation, return result. No `revalidateTag` needed since drafts are client-state driven (localStorage first), not server-rendered.

#### Phase 2: useDraft Hook (Single File — No Separate Store)

**Files to create:**

- `src/hooks/use-draft.ts` — Self-contained hook with localStorage + server sync

### Research Insights: Simplification

**No separate Zustand store needed.** The draft state is per-component (each compose surface has its own draft context). Unlike `pendingSendStore` which is global (any component can cancel any pending send), drafts are scoped to a specific compose instance. A simple hook with `useState` + `useRef` + `useCallback` is sufficient. This avoids adding a global store for per-component state.

```typescript
// src/hooks/use-draft.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DraftType } from "@prisma/client";
import {
  saveDraft as saveDraftAction,
  getDraft,
  deleteDraft as deleteDraftAction,
} from "@/actions/drafts";

export interface DraftData {
  to: string;
  subject: string;
  body: string;
  emailConnectionId?: string;
  attachmentIds: string[];
}

type DraftStatus = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 2000;
const SAVED_DISPLAY_MS = 2000;

function draftKey(userId: string, type: DraftType, contextId: string) {
  return `kurir:draft:${userId}:${type.toLowerCase()}:${contextId}`;
}

export function useDraft(
  userId: string,
  type: DraftType,
  contextMessageId: string = "__new__",
) {
  const [status, setStatus] = useState<DraftStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const latestDataRef = useRef<DraftData | null>(null);
  const key = draftKey(userId, type, contextMessageId);

  // Load draft: localStorage first, server fallback
  const loadDraft = useCallback(async (): Promise<DraftData | null> => {
    try {
      const local = localStorage.getItem(key);
      if (local) return JSON.parse(local) as DraftData;
    } catch { /* localStorage unavailable */ }

    // Server fallback
    const serverDraft = await getDraft(type, contextMessageId);
    if (serverDraft) {
      const data: DraftData = {
        to: serverDraft.to,
        subject: serverDraft.subject,
        body: serverDraft.body,
        emailConnectionId: serverDraft.emailConnectionId ?? undefined,
        attachmentIds: serverDraft.attachmentIds,
      };
      // Backfill localStorage
      try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
      return data;
    }
    return null;
  }, [key, type, contextMessageId]);

  // Save draft: localStorage sync + server async (debounced)
  const saveDraft = useCallback((data: DraftData) => {
    latestDataRef.current = data;

    // Clear previous debounce
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      // 1. localStorage (synchronous, instant)
      try {
        localStorage.setItem(key, JSON.stringify({
          ...data,
          updatedAt: Date.now(),
        }));
      } catch { /* QuotaExceededError — server is backup */ }

      // 2. Server action (async)
      setStatus("saving");
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        await saveDraftAction({
          type,
          contextMessageId,
          ...data,
        });
        setStatus("saved");
        setTimeout(() => setStatus("idle"), SAVED_DISPLAY_MS);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setStatus("error");
        }
      }
    }, DEBOUNCE_MS);
  }, [key, type, contextMessageId]);

  // Delete draft from both stores
  const removeDraft = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    try { localStorage.removeItem(key); } catch {}
    await deleteDraftAction(type, contextMessageId).catch(() => {});
    setStatus("idle");
  }, [key, type, contextMessageId]);

  // Flush to localStorage on unmount (crash recovery for in-debounce content)
  useEffect(() => {
    return () => {
      if (latestDataRef.current && timerRef.current) {
        clearTimeout(timerRef.current);
        try {
          localStorage.setItem(key, JSON.stringify({
            ...latestDataRef.current,
            updatedAt: Date.now(),
          }));
        } catch {}
      }
    };
  }, [key]);

  return { loadDraft, saveDraft, removeDraft, status };
}
```

### Research Insights: Race Conditions Mitigated

**AbortController for stale server saves.** When a new debounced save fires while a previous server action is in-flight, the `abortRef` cancels the old request. This prevents an older save from completing after a newer one, which would be a data consistency issue.

**Ref-based latest value tracking.** `latestDataRef` holds the most recent draft data. On unmount, if a debounce timer is pending, we flush to localStorage synchronously. This prevents losing content when the user navigates away mid-debounce.

**beforeunload flush.** The compose components should add a `beforeunload` handler that calls `localStorage.setItem` with the latest content. This is separate from the hook's unmount cleanup because `beforeunload` fires even when React doesn't unmount cleanly (tab close, browser crash recovery).

#### Phase 3: Compose UI Integration

**Files to modify:**

- `src/app/(mail)/compose/compose-client.tsx` — Integrate `useDraft` hook for new compose + forward
  - On mount: call `loadDraft()`. If draft exists AND (`updatedAt` > page load time OR no forward data), restore from draft. Otherwise use forward data.
  - On change: call `saveDraft(data)` — the hook handles debouncing
  - On send: call `removeDraft()` inside the `onExpire` callback of `pendingSendStore.enqueue()` (after undo window)
  - On schedule: call `removeDraft()` after `createScheduledMessage` succeeds
  - On discard/cancel: call `removeDraft()`
  - Add `<DraftStatusIndicator status={status} />` next to the Send button area
  - Add `beforeunload` handler for in-debounce flush

- `src/components/mail/reply-composer.tsx` — Integrate `useDraft` hook for replies
  - Accept `hasDraft` prop to auto-expand on mount
  - On mount: if `hasDraft`, set `isOpen: true` and call `loadDraft()` to restore content
  - **Draft-aware `to` field:** modify the `useEffect` that resets `to` to check `restoredFromDraft` ref. If the draft had a custom `to`, skip the reset.
  - On change: call `saveDraft({ body, to, attachmentIds })`
  - On send: call `removeDraft()` in the `onExpire` callback (not immediately — undo-send needs the server draft as backup)
  - On discard (X button): call `removeDraft()` before collapsing
  - Add `<DraftStatusIndicator status={status} />` in the footer bar

- `src/components/mail/thread-page-content.tsx` — Check localStorage for draft existence on mount
  - Quick synchronous check: `!!localStorage.getItem(draftKey(userId, "REPLY", lastMessageId))`
  - Pass `hasDraft` boolean to `<ReplyComposer>`

### Research Insights: Compose Integration

**Forward data conflict resolution.** When `/compose?forward={id}` has both server-provided `forwardData` and a saved draft, the draft should win IF it has been modified by the user (i.e., draft `updatedAt` is after the page was loaded, or draft body differs from forward body). If the draft is identical to the forward data, it's just a stale auto-save from a previous load — discard it.

**ReplyComposer `to` field race.** The existing `useEffect` on `replyToAddress` resets the `to` state. When restoring from a draft, this creates a race: draft sets `to` to "custom@email.com", then the effect fires and overwrites with `replyToAddress`. Fix: add a `restoredFromDraft` ref that's set to `true` during draft restoration, and check it in the `useEffect` before resetting.

**Draft existence check must be synchronous.** `ThreadPageContent` renders `<ReplyComposer hasDraft={...}>`. If `hasDraft` is determined async (server call), there's a flash: composer renders collapsed, then expands. Instead, check localStorage synchronously during render/mount. This is safe because localStorage reads are <1ms.

#### Phase 4: Draft Status Indicator

**Files to create:**

- `src/components/mail/draft-status-indicator.tsx` — Small status component

```typescript
// src/components/mail/draft-status-indicator.tsx
"use client";

import { Cloud, CloudOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DraftStatus } from "@/hooks/use-draft";

export function DraftStatusIndicator({ status }: { status: DraftStatus }) {
  if (status === "idle") return null;

  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-xs transition-opacity duration-300",
      status === "saved" && "text-muted-foreground animate-fade-out",
      status === "saving" && "text-muted-foreground",
      status === "error" && "text-amber-500",
    )}>
      {status === "saving" && <><Loader2 className="h-3 w-3 animate-spin" /> Saving...</>}
      {status === "saved" && <><Cloud className="h-3 w-3" /> Saved</>}
      {status === "error" && <><CloudOff className="h-3 w-3" /> Saved locally</>}
    </span>
  );
}
```

States:
- **Idle** — no indicator shown (no changes since last save)
- **Saving...** — subtle muted text + spinner (Loader2 icon, consistent with shadcn patterns)
- **Saved** — brief "Saved" text with Cloud icon, fades out after 2s via `animate-fade-out`
- **Error / Saved locally** — amber warning with CloudOff icon (server sync failed, localStorage succeeded)

### Research Insights: Status Indicator

**Placement:** In `ComposeClientPage`, place next to the Send/Schedule buttons in the footer. In `ReplyComposer`, place in the footer bar alongside "Cmd+Enter to send". Both locations are where the user's eye naturally goes during composition.

**Fade-out animation.** Add `animate-fade-out` to Tailwind config: `@keyframes fade-out { to { opacity: 0 } }` with `animation: fade-out 0.5s 1.5s forwards`. The "Saved" state shows for 1.5s, then fades over 0.5s. Total visibility: 2s — matches the `SAVED_DISPLAY_MS` constant.

**No toast for draft saves.** Toasts are reserved for user-initiated actions (send, archive, delete). Auto-save is background behavior — a subtle inline indicator is the right UX pattern.

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| New model vs reuse `Message`/`ScheduledMessage` | New `Draft` model | Cleanest separation. `Message.isDraft` is IMAP-only. `ScheduledMessage` has scheduling baggage. |
| NULL contextMessageId | Sentinel `"__new__"` instead of null | PostgreSQL NULL ≠ NULL in unique constraints. Sentinel ensures one NEW draft per user. |
| Debounce strategy | Single 2s debounce, dual write | One timer. localStorage write is sync (~<1ms) inside the callback. Simpler than two timers. |
| Store architecture | `useDraft` hook (no Zustand store) | Draft state is per-component, not global. Simple hook > global store for scoped state. |
| IMAP Drafts folder sync | No (MVP) | Adds significant complexity (APPEND, UID tracking, conflict with other clients). Defer to post-MVP. |
| Draft deletion on send | Both: after undo window expires | Delete in `onExpire` callback of `pendingSendStore.enqueue()`. If undo, draft is still in localStorage. |
| Forward draft vs server data | Draft wins if body differs from forward | User edits should never be silently lost. Stale auto-saves (identical to forward) are discarded. |
| ReplyComposer auto-expand on draft | Yes, via `hasDraft` prop | Synchronous localStorage check in parent. Discoverability > minimal surprise. |
| Multi-tab conflicts | Last-write-wins (MVP) | Acceptable for single-user email client. Can add `BroadcastChannel` later. |
| Empty draft handling | Auto-delete on debounce | If body, subject, and attachments are all empty, call `removeDraft()`. Prevents stale empties. |
| `beforeunload` | Flush latest content to localStorage | Prevents losing keystrokes in the 2s debounce window on tab close. |
| Server sync failure | Show "Saved locally" (amber), auto-retry next debounce | Silent failures erode trust. localStorage is the safety net. |
| Draft body encryption | Match ScheduledMessage pattern | Email content is sensitive. Encrypt at rest in PostgreSQL. |
| Attachment ownership | Validate in saveDraft action | Prevent cross-user attachment reference via malicious client. |

### Undo-Send Integration

```
User clicks Send
  ├── Cancel debounce timer (prevent save-after-send race)
  ├── pendingSendStore.enqueue(onExpire: actualSend + removeDraft)
  │
  ├── [User clicks Undo within 5s]
  │   ├── pendingSendStore.cancel()
  │   ├── Composer re-opens with content from refs (existing behavior)
  │   └── Draft is still in localStorage + server (not deleted yet)
  │   └── Next keystroke re-activates auto-save normally
  │
  └── [Undo window expires]
      ├── actualSend() fires
      ├── On success: removeDraft() deletes from localStorage + server
      └── On failure: draft survives (still in both stores)
```

### Research Insights: Undo-Send Race Prevention

**Key change from original plan:** Do NOT delete the draft immediately on Send click. Instead, defer deletion to the `onExpire` callback (after undo window). This means:
- If user undoes: draft is intact in both localStorage and server. No re-creation needed.
- If send succeeds: draft is cleaned up by `removeDraft()`.
- If send fails: draft survives — user can retry.
- If browser crashes during undo window: draft is in both stores — full recovery.

**Cancel the debounce timer on Send.** If the user types, then immediately hits Send, a debounce timer may be pending. Cancel it to prevent a `saveDraft` server action from firing concurrently with (or after) the send action. The content is already captured in the send payload.

## Acceptance Criteria

### Functional Requirements

- [x] Typing in any compose surface auto-saves a draft after ~2s of inactivity
- [x] Draft persists across page reload (localStorage)
- [x] Draft persists across browser sessions (server sync)
- [x] Navigating away from `/compose` and returning restores the draft
- [x] Navigating away from a thread and returning restores the reply draft
- [x] ReplyComposer auto-expands when a saved draft exists for the thread
- [x] Forward drafts preserve user edits over server-provided forward data
- [x] Draft is deleted when message is successfully sent
- [x] Draft is deleted when message is scheduled
- [x] Draft is re-created if send is undone
- [x] Discarding a reply (via X button) deletes the draft
- [x] Empty drafts are automatically cleaned up
- [x] Draft status indicator shows saving/saved/error states
- [x] `useBeforeUnload` warns about unsaved draft changes
- [x] Attachment IDs are preserved in drafts
- [x] `fromConnectionId` selection is preserved in drafts (full compose)
- [x] All draft DB queries filter by `userId`

### Non-Functional Requirements

- [x] localStorage writes complete in <10ms (no perceptible lag while typing)
- [x] Server sync does not block the UI (fire-and-forget with status update)
- [x] No data loss on browser crash (localStorage is the safety net)

## Dependencies & Risks

**Dependencies:**
- Prisma schema change (`pnpm db:push`)
- No new npm dependencies needed (Zustand already installed)

**Risks:**
- localStorage 5-10MB limit: mitigated by storing only text content, not attachments
- Stale drafts accumulating: mitigated by auto-delete on empty + 30-day server TTL (future)
- Multi-tab conflicts: accepted as last-write-wins for MVP

## Future Considerations

- **IMAP Drafts folder sync** — append drafts to server Drafts folder so they appear in other clients
- **Drafts sidebar section** — dedicated "Drafts" nav item with count badge
- **Multi-tab sync** — `BroadcastChannel` API for real-time cross-tab draft updates
- **Rich text drafts** — if markdown composer is upgraded to rich text, draft format may change
- **Draft expiry cleanup** — background job to delete server drafts older than 30 days

## References & Research

### Internal References

- `src/stores/pending-send-store.ts` — Zustand store pattern reference
- `src/actions/scheduled-messages.ts` — Server action pattern (auth, validation, encryption)
- `src/lib/mail/persist-sent.ts` — Persistence helper pattern (negative UIDs, createLocalSentMessage)
- `src/app/(mail)/compose/compose-client.tsx` — Full compose integration point
- `src/components/mail/reply-composer.tsx` — Reply compose integration point
- `src/components/mail/markdown-composer.tsx` — onChange trigger point for auto-save
- `docs/solutions/integration-issues/sent-messages-missing-from-thread-views.md` — Persistence architecture learnings

### Key Files to Modify

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `Draft` model + `DraftType` enum |
| `src/actions/drafts.ts` | New file: CRUD server actions (saveDraft, getDraft, deleteDraft, getUserDrafts) |
| `src/hooks/use-draft.ts` | New file: useDraft hook with localStorage + server sync |
| `src/components/mail/draft-status-indicator.tsx` | New file: save status UI (idle/saving/saved/error) |
| `src/app/(mail)/compose/compose-client.tsx` | Integrate useDraft, restore/save/delete, forward conflict resolution |
| `src/components/mail/reply-composer.tsx` | Integrate useDraft, hasDraft prop, draft-aware to field reset |
| `src/components/mail/thread-page-content.tsx` | Sync localStorage check for draft existence, pass hasDraft |
| `tailwind.config.ts` | Add `animate-fade-out` keyframe for DraftStatusIndicator |
