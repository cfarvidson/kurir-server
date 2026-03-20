# Learnings: Bug Hunt -- Categorization, Undo, Follow-ups, Search

**Date:** 2026-03-20
**Task:** Systematic codebase bug hunt

---

## Bug 1: Archived messages appearing in Imbox (sync-service.ts)

**Root cause:** `processMessage` computed `finalIsArchived` AFTER the category flags (`isInImbox`, `isInFeed`, `isInPaperTrail`). When `isArchived=true` was passed for an approved sender's message, it got both `isArchived: true` AND `isInImbox: true`.

**Pattern to watch for:** When boolean flags are interdependent, compute the "gate" flag first. Here, `finalIsArchived` must be computed before any category flags that should be mutually exclusive with it.

## Bug 2: undoScreenAction restoring non-inbox messages (senders.ts)

**Root cause:** `updateMany({ where: { senderId } })` with no folder filter. Sender records span multiple folders (inbox, sent, all-mail). Only inbox messages should go back to screener on undo.

**Pattern to watch for:** When a sender-level action needs to affect messages, always consider that the sender's messages may span multiple folders. Filter by inbox folderId.

## Bug 3: Follow-ups not firing during manual sync (sync route)

**Root cause:** The manual sync API route copied `wakeExpiredSnoozes` from background-sync but not `checkExpiredFollowUps`. Two entry points for sync logic means features added to one can be missed in the other.

**Pattern to watch for:** Duplicate sync paths. The background sync and manual sync route share logic but are separate code paths. When adding periodic tasks, ensure both paths are updated.

## Bug 4: Search broken for non-Latin scripts (search.ts)

**Root cause:** Regex `[^a-zA-Z0-9\u00C0-\u024F\s]` strips everything outside Latin Extended-B. Fixed with `[^\p{L}\p{N}\s]` (Unicode property escapes).

**Pattern to watch for:** Character class regexes that enumerate Unicode ranges instead of using `\p{L}` property escapes. The `u` flag is required for Unicode property escapes in JS.

## Areas Reviewed and Found Clean

- Auth flow (JWT, middleware, edge-safe split)
- Image proxy (thorough SSRF protection)
- IMAP IDLE (echo suppression, reconnect backoff, CONDSTORE catch-up)
- Scheduled messages (CAS locking, idempotency, retry backoff)
- All API routes (userId checks, ownership verification, Zod validation)
- Threading (two-pass approach, dedup logic)
