---
title: "fix: IMAP archive move on screen out"
type: fix
date: 2026-03-18
deepened: 2026-03-18
---

# fix: IMAP archive move on screen out

## Enhancement Summary

**Deepened on:** 2026-03-18
**Research agents used:** architecture-strategist, code-simplicity-reviewer, performance-oracle, kieran-typescript-reviewer, Context7 (Next.js, ImapFlow)

### Key Improvements
1. Confirmed `after()` is stable in Next.js 15.1 — no experimental flag needed
2. Identified silent failure mode: `moveToArchiveViaImap` logs success even when IMAP connection returns null
3. Simplified from 3 phases to 2 — dropped IDLE handler phase (YAGNI)
4. Dropped `movedIds` partial-batch tracking — self-healing re-sync makes it unnecessary

### New Considerations Discovered
- `moveToArchiveViaImap()` has no way to signal failure — `withImapConnection` swallows errors and returns null
- Archive folder discovery logic is duplicated in 3 places — extract into shared helper
- The 60-second sync cycle via `moveRejectedToArchive()` is a sufficient safety net for IDLE-path messages

## Overview

When a user screens out (rejects) a sender, messages are archived in the database (`isArchived: true`) but never moved on the IMAP server. Both existing code paths fail silently:

1. `rejectSender()` defers IMAP move via `after()` → `moveToArchiveViaImap()` — never executes successfully
2. `syncEmailConnection()` calls `moveRejectedToArchive()` — also fails to move

The IDLE handler (`handleNewMessages`) auto-archives rejected-sender messages in DB but relies on the 60-second sync cycle to clean up the IMAP inbox. This is acceptable.

## Problem Statement

The IMAP inbox accumulates "junk" emails from rejected senders that should be in the IMAP archive folder. The user expects that screening out a sender cleans up both the Kurir UI and the actual IMAP inbox. Currently only the UI side works.

## Proposed Solution

### Phase 1: Debug and fix `rejectSender()` after() path

**File:** `src/actions/senders.ts:125-148`

The `after()` callback calls `moveToArchiveViaImap()` but the IMAP move never succeeds.

#### Research Insights

**`after()` is stable in Next.js 15.1** — no `experimental.after` config needed (confirmed via Context7 docs). The project uses `next@^15.1.0` with `output: "standalone"`. The `after()` import from `next/server` is correct. The pattern is already used in 5 places across `archive.ts` and `senders.ts`.

**Silent failure mode identified:** `moveToArchiveViaImap()` calls `await withImapConnection(...)`. If the connection fails, `withImapConnection` catches the error (line 30-31 of `imap-client.ts`), logs it, and returns `null`. But `moveToArchiveViaImap` doesn't check the return value — it just returns `undefined`. The `after()` callback's `try/catch` never fires because no error is thrown. The "IMAP archive move complete" success log at `senders.ts:137` prints even when the connection failed silently.

**ImapFlow `messageMove` accepts `number[]` directly** — confirmed via Context7 docs and documented learning. No need to convert to string format.

#### Debugging steps (in order):

1. Add `console.log("[reject] after() callback fired")` as first line inside `after()` to confirm execution
2. Make `moveToArchiveViaImap` signal failure — either return a boolean or throw when `withImapConnection` returns null
3. Add connection success/failure logging to `withImapConnection` (it already logs errors at line 31, but add a log when credentials are not found at line 14)
4. Test with a real screen-out and read logs

#### Fix checklist:

- [x] Add `console.log` at start of `after()` callback in `rejectSender()` to confirm execution (`src/actions/senders.ts:129`)
- [x] Add logging when `getConnectionCredentials` returns null in `withImapConnection()` (`src/lib/mail/imap-client.ts:14`)
- [x] Make `moveToArchiveViaImap` return success/failure indicator so callers know the move actually happened
- [ ] Test with a real screen-out action and verify console output shows the full flow
- [ ] Fix whatever the logs reveal as the root cause

### Phase 2: Harden `moveRejectedToArchive()` during sync

**File:** `src/lib/mail/sync-service.ts:669-729`

This function already exists and acts as a safety net. Once Phase 1 is fixed, Phase 2 is about making the safety net robust.

#### Research Insights

**Echo suppression is missing** — `moveToArchiveViaImap()` (archive.ts:66-68) calls `suppressEcho()` for every UID before the move. `moveRejectedToArchive()` does not. Without it, the IDLE `handleExpunge` handler could fire for moved messages. The `isArchived` guard at `idle-handlers.ts:222` currently prevents data corruption, but adding echo suppression makes the protection explicit rather than accidental.

**Partial-batch tracking is unnecessary** — The simplicity review determined that the `movedIds` array adds bookkeeping for zero benefit. When a batch fails: (1) if the IMAP move succeeded, deleting the DB record is correct; (2) if it failed, the message stays in IMAP inbox, gets re-synced with `isArchived: true`, and `moveRejectedToArchive` retries on the next cycle. The system self-heals in both cases.

**Delete-then-recreate is simpler than update-in-place** — `messageMove` doesn't return the new UID in the target folder. To update `folderId` and `uid` in place, you'd need to search the archive folder by `messageId`. The current delete-then-recreate pattern requires zero additional queries.

#### Fix checklist:

- [x] Add echo suppression before IMAP move — requires passing `userId` into the function (`sync-service.ts:669`)
- [x] Add logging at top to confirm the function is called and report `stale.length`
- [x] Keep the existing unconditional `deleteMany` — don't add partial-batch tracking

#### Updated function signature:

```typescript
// sync-service.ts — add userId parameter
async function moveRejectedToArchive(
  client: ImapFlow,
  mailboxes: Awaited<ReturnType<ImapFlow["list"]>>,
  userId: string,
  inboxFolderId: string,
) {
  const stale = await db.message.findMany({ ... }); // existing query
  if (stale.length === 0) return;

  console.log(`[sync] moveRejectedToArchive: found ${stale.length} message(s) to move`);

  // Add echo suppression (import from flag-push.ts)
  for (const msg of stale) {
    suppressEcho(userId, inboxFolderId, msg.uid);
  }

  // ... rest of existing logic unchanged
}
```

### Phase 3: DROPPED — IDLE handler IMAP move

~~Handle IDLE path for rejected senders~~

**Why dropped:** The 60-second background sync already catches rejected-sender messages via `moveRejectedToArchive()`. A rejected-sender email sitting in the IMAP inbox for up to 60 seconds is invisible in Kurir (the DB already has `isArchived: true`). Adding IMAP move logic to the IDLE handler would:
- Create a second code path doing the same thing as `moveRejectedToArchive()`
- Require the IDLE handler to resolve archive folder paths (currently not its concern)
- Break the IDLE handler's read-only IMAP pattern for a 60-second latency improvement no user will notice

### Optional: Extract shared archive folder discovery

The pattern `mailboxes.find(mb => mb.specialUse === "\\Archive" || ...) ?? mailboxes.find(mb => mb.specialUse === "\\All")` appears in 3 places:
- `moveToArchiveViaImap()` (archive.ts:72-77)
- `moveToInboxViaImap()` (archive.ts:123-127)
- `moveRejectedToArchive()` (sync-service.ts:688-693)

Extract into a shared helper to prevent drift:

```typescript
// src/lib/mail/imap-client.ts
export function findArchiveMailbox(mailboxes: Awaited<ReturnType<ImapFlow["list"]>>) {
  return (
    mailboxes.find(
      (mb) => mb.specialUse === "\\Archive" || mb.path.toLowerCase() === "archive"
    ) ?? mailboxes.find((mb) => mb.specialUse === "\\All")
  );
}
```

## Acceptance Criteria

- [ ] When a user screens out a sender, all messages from that sender are moved from IMAP inbox to IMAP archive folder
- [ ] When a new message arrives from a REJECTED sender during sync, it is moved to IMAP archive by `moveRejectedToArchive()`
- [ ] `moveRejectedToArchive()` uses echo suppression to prevent IDLE handler conflicts
- [ ] Console logs clearly indicate success/failure of IMAP moves at every step of the chain
- [ ] `moveToArchiveViaImap` signals failure when `withImapConnection` returns null

## Key Files

- `src/actions/senders.ts:55-149` — `rejectSender()` with `after()` callback
- `src/actions/archive.ts:60-108` — `moveToArchiveViaImap()`
- `src/lib/mail/sync-service.ts:669-729` — `moveRejectedToArchive()`
- `src/lib/mail/sync-service.ts:430-443` — `processMessage()` rejected sender handling
- `src/lib/mail/idle-handlers.ts` — `handleNewMessages()` (no changes needed)
- `src/lib/mail/flag-push.ts` — `suppressEcho()` / `isEcho()`
- `src/lib/mail/imap-client.ts` — `withImapConnection()` helper + `findArchiveMailbox()` (new)

## References

- Brainstorm: `docs/brainstorms/2026-03-18-imap-archive-on-reject-brainstorm.md`
- Learning: `docs/solutions/feature-implementations/auto-archive-rejected-screener-messages.md`
- Learning: `docs/solutions/performance-issues/sync-timeout-on-large-mailboxes.md`
- Next.js `after()` docs: stable in 15.1, works in Server Functions
- ImapFlow `messageMove`: accepts `number[]` directly, returns `{ destination, uidMap }`
