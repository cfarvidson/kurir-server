---
title: "feat: Auto-archive messages rejected from Screener"
type: feat
date: 2026-03-17
deepened: 2026-03-17
---

# Auto-Archive Messages Rejected from Screener

## Enhancement Summary

**Deepened on:** 2026-03-17
**Review agents used:** architecture-strategist, data-integrity-guardian, performance-oracle, code-simplicity-reviewer

### Key Simplifications (from review)
1. **Dropped new `imap-move.ts` file** — just export existing helpers from `archive.ts` (two consumers don't justify a new abstraction)
2. **Dropped re-approve unarchive flow** — YAGNI; future messages are correctly handled by `processMessage`; blind unarchive of ALL messages (including manually archived) is a data-correctness bug
3. **Dropped archive folder dedup fix** — pre-existing concern unrelated to this feature; manual archive has worked without it

### Key Improvements Added
1. **Batch IMAP moves** — use UID sequence sets instead of serial loop (100x perf improvement for prolific senders)
2. **Guard `handleExpunge` against archived messages** — prevents `isDeleted: true` corruption when echo suppression TTL expires during bulk moves
3. **Parallelize pre-transaction queries** — `Promise.all` for independent message/folder fetches

---

## Overview

When a sender is rejected from the Screener, their messages currently enter "limbo" — all boolean flags are cleared but `isArchived` stays false, so they appear in no view. This change makes rejected messages go to the Archive instead, both in the DB and via IMAP.

## Problem Statement

- `rejectSender()` sets `isInScreener`, `isInImbox`, `isInFeed`, `isInPaperTrail` all to `false` but leaves `isArchived: false`
- Messages become invisible — not in any category, not in Archive, nowhere
- New messages arriving from previously-rejected senders also go to limbo (`processMessage()` has no `REJECTED` branch)

## Proposed Solution

Two focused changes:

1. **`rejectSender()`** — archive messages + IMAP move to Archive folder
2. **`processMessage()`** — auto-archive new messages from REJECTED senders during sync

**Not changing `approveSender()`** — when re-approving a rejected sender, only future messages go to the chosen category. Existing archived messages stay archived (the user can manually unarchive specific ones). This avoids the data-correctness bug of unarchiving messages the user manually archived before the rejection.

## Acceptance Criteria

- [x] Rejecting a sender archives all their non-archived messages (`isArchived: true`, all category flags `false`, snooze cleared)
- [x] Rejected sender's messages appear in the Archive view
- [x] IMAP move to Archive folder is deferred via `after()` (non-blocking)
- [x] IMAP moves use batched UID sequence sets (not serial per-UID loop)
- [x] New messages from rejected senders are auto-archived during sync (`processMessage`)
- [x] Echo suppression works correctly for IMAP moves; `handleExpunge` guards against archived messages
- [x] Sidebar counts update correctly after rejection
- [x] Snoozed messages from rejected senders have snooze cleared on archive

## Technical Approach

### 1. Export IMAP move helpers from `src/actions/archive.ts`

Add `export` to `moveToArchiveViaImap()` and `moveToInboxViaImap()`. No new file needed — `senders.ts` imports directly from `archive.ts`.

**While exporting, batch the IMAP move loop** (applies to all existing callers too):

```typescript
// Before (serial, O(n) round trips):
for (const uid of uids) {
  await client.messageMove(String(uid), archiveBox.path, { uid: true });
}

// After (batched, O(1) round trip):
const BATCH_SIZE = 100;
for (let i = 0; i < uids.length; i += BATCH_SIZE) {
  const chunk = uids.slice(i, i + BATCH_SIZE);
  try {
    await client.messageMove(chunk.join(","), archiveBox.path, { uid: true });
  } catch {
    // Batch may partially fail; individual messages may already be moved
  }
}
```

> **Note:** The CLAUDE.md gotcha about comma-separated UIDs applies to `client.fetch()`, not `client.messageMove()`. The MOVE command uses standard IMAP sequence set syntax which supports comma-separated values.

### 2. Modify `rejectSender()` in `src/actions/senders.ts`

```typescript
import { after } from "next/server";
import { moveToArchiveViaImap } from "@/actions/archive";

export async function rejectSender(senderId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const userId = session.user.id;

  // Consolidate into single query (was two separate fetches)
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    select: { userId: true, emailConnectionId: true },
  });
  if (!sender || sender.userId !== userId) throw new Error("Sender not found");

  // Parallelize independent queries
  const [inboxMessages, inboxFolder] = await Promise.all([
    db.message.findMany({
      where: { senderId, isArchived: false, uid: { gt: 0 } },
      select: { uid: true, folderId: true },
    }),
    db.folder.findFirst({
      where: { emailConnectionId: sender.emailConnectionId, specialUse: "inbox" },
      select: { id: true },
    }),
  ]);

  const inboxUids = inboxFolder
    ? inboxMessages.filter(m => m.folderId === inboxFolder.id).map(m => m.uid)
    : [];

  // Transaction: reject sender + archive messages
  await db.$transaction([
    db.sender.update({
      where: { id: senderId },
      data: { status: "REJECTED", decidedAt: new Date() },
    }),
    db.message.updateMany({
      where: { senderId, isArchived: false },
      data: {
        isInScreener: false,
        isInImbox: false,
        isInFeed: false,
        isInPaperTrail: false,
        isArchived: true,
        isSnoozed: false,
        snoozedUntil: null,
      },
    }),
  ]);

  revalidateTag("sidebar-counts");
  revalidatePath("/screener");
  revalidatePath("/archive");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");

  // Defer IMAP move (batched)
  if (inboxUids.length > 0 && inboxFolder) {
    after(() =>
      moveToArchiveViaImap(userId, sender.emailConnectionId, inboxFolder.id, inboxUids)
        .catch(err => console.error("IMAP archive move (reject) failed:", err))
    );
  }
}
```

### 3. Modify `processMessage()` in `src/lib/mail/sync-service.ts`

Add a `REJECTED` branch at line ~427. Two lines of change:

```typescript
const isInScreener = isInbox && !isArchived && sender.status === "PENDING";
const isRejectedInbox = isInbox && !isArchived && sender.status === "REJECTED";  // NEW
const isInImbox = isInbox && sender.status === "APPROVED" && sender.category === "IMBOX";
const isInFeed = isInbox && sender.status === "APPROVED" && sender.category === "FEED";
const isInPaperTrail = isInbox && sender.status === "APPROVED" && sender.category === "PAPER_TRAIL";

// Use finalIsArchived in the db.message.create() call
const finalIsArchived = isArchived || isRejectedInbox;  // NEW
```

No IMAP move during sync — accept DB/IMAP divergence (consistent with existing "DB is authoritative" pattern).

### 4. Guard `handleExpunge` in `src/lib/mail/idle-handlers.ts`

Prevent `isDeleted: true` corruption when echo suppression TTL expires during bulk moves:

```typescript
// In handleExpunge, before marking as deleted:
const message = await db.message.findFirst({
  where: { folderId, uid },
  select: { id: true, isArchived: true },
});
if (!message || message.isArchived) return; // Don't delete archived messages
```

This is the simplest and most robust fix for the echo suppression TTL concern. It protects against any scenario where an archived message's UID disappears from INBOX.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Reject PENDING sender from Screener card | Messages archived + IMAP moved (batched) |
| Reject APPROVED sender from ScreenedSenderList | Messages archived from category views + IMAP moved |
| New message from rejected sender (sync/IDLE) | Auto-archived in DB, stays in INBOX on IMAP |
| Re-approve rejected sender | Only future messages go to chosen category; archived messages stay in Archive |
| Multi-party thread with rejected sender | Only rejected sender's messages archived; thread may split |
| Snoozed message from rejected sender | Snooze cleared, message archived |
| IMAP move fails | DB is authoritative; message shows in Archive view regardless |
| `autoRejectFullyArchivedSenders` | No change needed — messages already archived before auto-reject |
| Prolific sender (500+ messages) | Batched IMAP move handles in ~300ms vs ~50s serial |
| TOCTOU: new message arrives between pre-fetch and transaction | DB `updateMany` catches it; IMAP UID list misses it (acceptable divergence) |
| Existing auto-rejected senders | Their future messages now auto-archive during sync (behavior change, desired) |

## Files to Modify

| File | Change | LOC |
|------|--------|-----|
| `src/actions/archive.ts` | Export `moveToArchiveViaImap` + `moveToInboxViaImap`; batch the IMAP move loop | ~10 |
| `src/actions/senders.ts` | `rejectSender`: archive + IMAP move | ~20 |
| `src/lib/mail/sync-service.ts` | `processMessage`: add `isRejectedInbox` + `finalIsArchived` | ~2 |
| `src/lib/mail/idle-handlers.ts` | Guard `handleExpunge` against archived messages | ~3 |

**Total: ~35 lines changed across 4 files. No new files.**

## Out of Scope

- Re-approve unarchive flow (YAGNI — future messages handled correctly; blind unarchive is a data-correctness bug)
- New `imap-move.ts` shared module (two consumers don't justify abstraction)
- Archive folder dedup fix (pre-existing concern, not caused by this feature)
- Confirmation dialog for rejecting APPROVED senders
- "Archived by rejection" visual indicator in Archive view
- Bulk reject old senders counterpart to `bulkApproveOldSenders`
- IMAP move during sync for rejected sender messages (accept DB/IMAP divergence)

## References

- `src/actions/senders.ts:53-95` — current `rejectSender()` implementation
- `src/actions/archive.ts:60-96` — `moveToArchiveViaImap()` to export and batch
- `src/actions/archive.ts:134-198` — `archiveConversation()` as reference for archive flow
- `src/lib/mail/sync-service.ts:427-435` — `processMessage()` categorization logic
- `src/lib/mail/idle-handlers.ts` — `handleExpunge` to guard against archived messages
- `src/lib/mail/flag-push.ts` — echo suppression (10s TTL)
