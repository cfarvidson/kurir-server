---
title: "Auto-Archive Rejected Screener Messages"
category: feature-implementations
tags: [screener, archive, reject, imap, imapflow, batch, idle, echo-suppression]
module: actions/senders, lib/mail/sync-service, lib/mail/idle-handlers, actions/archive
symptom: "Rejected sender messages disappear into limbo (all boolean flags false, invisible in every view)"
root_cause: "rejectSender() cleared all category flags but never set isArchived: true"
date: 2026-03-17
---

# Auto-Archive Rejected Screener Messages

## Problem

When a sender was rejected from the Screener, `rejectSender()` set all category boolean flags to `false` (`isInScreener`, `isInImbox`, `isInFeed`, `isInPaperTrail`) but left `isArchived: false`. Messages entered "limbo" — they existed in the DB but appeared in no view. Additionally, new messages from previously-rejected senders during sync also went to limbo because `processMessage()` had no `REJECTED` branch.

## Solution

### 1. `rejectSender()` — archive + IMAP move (`src/actions/senders.ts`)

Added `isArchived: true, isSnoozed: false, snoozedUntil: null` to the `updateMany` data. Added deferred IMAP move via `after()` using the exported `moveToArchiveViaImap` from `archive.ts`. Pre-transaction queries (messages + inbox folder) are parallelized with `Promise.all`.

### 2. `processMessage()` — auto-archive rejected senders (`src/lib/mail/sync-service.ts`)

Added two lines:

```typescript
const isRejectedInbox = isInbox && !isArchived && sender.status === "REJECTED";
const finalIsArchived = isArchived || isRejectedInbox;
```

Then used `finalIsArchived` in the `db.message.create()` call. No IMAP move during sync (DB is authoritative).

### 3. `handleExpunge` guard (`src/lib/mail/idle-handlers.ts`)

Added `isArchived` to the select and a guard: `if (message.isArchived) return;`. This prevents archived messages from being marked `isDeleted: true` when the IDLE expunge handler fires after echo suppression TTL expires during bulk IMAP moves.

### 4. Batched IMAP moves (`src/actions/archive.ts`)

Replaced serial per-UID `messageMove` loop with batched chunks of 100 UIDs. Pass `number[]` directly to `messageMove` (not `chunk.join(",")` string) — ImapFlow's `resolveRange()` has a validated code path for arrays.

## Key Insights

### ImapFlow messageMove accepts number[] directly

The CLAUDE.md gotcha about comma-separated UID strings applies to `client.fetch()`. For `messageMove`, pass the `number[]` array directly — ImapFlow's type signature accepts it and the internal `resolveRange()` handles it correctly. Safer than string format.

### Don't unarchive on re-approve (YAGNI)

The initial plan included unarchiving all messages when re-approving a rejected sender. This was dropped because:

- It would also unarchive messages the user **manually** archived before the rejection — a data-correctness bug
- Without an `archivedByRejection` flag, there's no way to distinguish user-archived from rejection-archived
- Future messages are correctly handled by `processMessage()` once the sender status changes to APPROVED
- Users can manually unarchive specific messages if needed

### Don't create shared modules for 2 consumers

Instead of extracting `moveToArchiveViaImap` and `moveToInboxViaImap` into a new `imap-move.ts` file, just add `export` to the existing functions in `archive.ts`. Two consumers don't justify a new abstraction.

### Guard IDLE handlers against archived messages

Echo suppression has a 10-second TTL. When bulk-moving hundreds of messages via IMAP (even batched), some expunge events may arrive after suppression expires. Adding `if (message.isArchived) return` to `handleExpunge` is a simple, robust guard that prevents `isDeleted: true` corruption.

### TOCTOU in rejectSender is acceptable

Messages are fetched before the transaction for IMAP UID collection. A message arriving between fetch and transaction gets caught by the `updateMany` (DB side) but missed by the IMAP move. This is fine — DB is authoritative, and `processMessage()` will auto-archive it on the next sync anyway.

## Files Changed

- `src/actions/senders.ts` — `rejectSender()`: archive + IMAP move
- `src/lib/mail/sync-service.ts` — `processMessage()`: auto-archive REJECTED senders
- `src/lib/mail/idle-handlers.ts` — `handleExpunge`: guard against archived messages
- `src/actions/archive.ts` — Export IMAP move helpers, batch the move loop
