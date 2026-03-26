# Archive Sync from All Mail

**Date:** 2026-02-19
**Status:** Ready for planning

## What We're Building

Messages archived on the IMAP server (in Gmail's All Mail but not in INBOX) should be marked `isArchived = true` during sync instead of going through Screener/categorization. Currently all synced messages default to `isArchived = false`, so archived messages appear as active inbox/screener items after resync.

## Why This Approach

**Mark All Mail-only messages as archived at sync time, skip the Screener.**

The sync order is already guaranteed: INBOX → Sent → All Mail. By the time All Mail is processed, any message that passes the dedup check (doesn't already exist from INBOX/Sent sync) is by definition archived — it exists on the server but not in INBOX.

- Simplest possible fix — leverages existing dedup logic
- No extra DB queries or post-sync passes
- No Gmail-specific APIs (X-GM-LABELS) needed

**Rejected alternatives:**

- Post-sync pass comparing All Mail vs INBOX — extra queries, unnecessary complexity for the same result
- Gmail X-GM-LABELS — most accurate but Gmail-specific, violates IMAP generality

## Key Decisions

- **Archived messages skip Screener entirely** — they're old/handled, no point in screening them
- **Archived messages get category flags based on sender** — if sender is APPROVED, set the appropriate category flag alongside `isArchived = true` (so they appear correctly in Archive view). If sender is PENDING, just `isArchived = true` with no category flags.
- **Only applies to All Mail sync** — INBOX messages are never auto-archived. Sent messages are unchanged.
- **Add `isArchived` param to `processMessage()`** — similar to how `isInbox` and `userEmail` are threaded through

## Open Questions

- Should this also handle non-Gmail Archive folders? (Likely YAGNI for now — would need to sync the Archive folder first)
