# Bidirectional IMAP Sync with Realtime Updates

**Date:** 2026-02-19
**Status:** Brainstorm complete

## What We're Building

Full two-way IMAP synchronization so that changes made in any IMAP client (Apple Mail, Gmail web, Thunderbird, etc.) are reflected in Kurir in realtime, and vice versa. This covers:

- **Flag sync (both directions):** `\Seen`, `\Flagged`, `\Answered`, `\Deleted`, `\Draft`
- **Archive/move detection:** Messages moved out of INBOX by another client → marked as archived in Kurir (category preserved)
- **Kurir → IMAP pushback:** When Kurir marks a message as read, flagged, or archived, the corresponding IMAP flag/move is performed
- **Expunge detection:** Messages permanently deleted on the server are removed or marked deleted in Kurir

## Why This Approach

**IDLE + CONDSTORE** — combines realtime notification with efficient change detection.

### IMAP IDLE

- ImapFlow supports IDLE natively — the client stays connected and receives push notifications when the mailbox state changes (new messages, flag changes, expunges)
- IDLE only monitors one mailbox per connection, so we need one connection per watched folder (INBOX + Archive at minimum)
- For 2-10 users, this means 4-20 persistent IMAP connections — well within resource limits

### CONDSTORE / MODSEQ

- When IDLE fires (or on periodic fallback), use `FETCH 1:* (FLAGS) (CHANGEDSINCE <lastModSeq>)` to get only messages whose flags changed since last check
- The `Folder.highestModSeq` column already exists in the schema but is unused — this will finally populate it
- Falls back to full flag comparison if the server doesn't support CONDSTORE

### Two-way conflict avoidance

- When Kurir pushes a change to IMAP (e.g., setting `\Seen`), record the expected MODSEQ bump so the next IDLE event doesn't "echo" the change back
- Simple "last writer wins" — no complex conflict resolution needed for flags

## Key Decisions

1. **Full two-way sync** — not just IMAP→Kurir. Kurir actions (read, flag, archive) push to IMAP server.
2. **IMAP IDLE for realtime** — persistent connections per user per watched folder.
3. **CONDSTORE for efficient delta** — only fetch changed flags, not full mailbox scan.
4. **Archive from other client = isArchived + keep category** — when a message disappears from INBOX, set `isArchived: true` but preserve `isInImbox`/`isInFeed`/`isInPaperTrail` so the user can see where it belonged.
5. **Scale target: 2-10 users** — connection management can be simple (in-process Map), no need for Redis-backed connection pools.

## Current State

The sync engine today is **append-only, one-directional:**

- Only new UIDs are downloaded; existing messages are never re-checked
- IMAP flags are captured at initial sync but never updated
- `Folder.highestModSeq` exists in schema but is never written
- Archive action already pushes to IMAP (via `messageMove`), but read/flag changes are local-only

## Architecture Sketch

```
┌─────────────────────────────────────────────────┐
│                 Connection Manager               │
│  Map<userId, { inbox: IdleClient, archive: … }>  │
│  Lifecycle: start on login, stop on logout       │
└──────────┬───────────────────┬──────────────────┘
           │ IDLE event        │ periodic fallback
           ▼                   ▼
┌─────────────────────────────────────────────────┐
│              Delta Sync (CONDSTORE)              │
│  FETCH FLAGS CHANGEDSINCE <highestModSeq>        │
│  Compare with DB → apply changes                 │
└──────────┬───────────────────┬──────────────────┘
           │                   │
    ┌──────▼──────┐    ┌──────▼──────┐
    │ Flag changes│    │UID removals │
    │ → update DB │    │ → isArchived│
    └─────────────┘    └─────────────┘

┌─────────────────────────────────────────────────┐
│            Kurir → IMAP Push Layer               │
│  On server action: set IMAP flag + update DB     │
│  Record expected MODSEQ to avoid echo            │
└─────────────────────────────────────────────────┘
```

## Open Questions

1. **Which folders to IDLE on?** INBOX is obvious. Archive? Sent? Each adds a connection.
2. **Server CONDSTORE support:** What happens with servers that don't advertise CONDSTORE? Full flag reconciliation as fallback?
3. **Connection lifecycle:** Start IDLE on app start? On first request? What about reconnection after network failures?
4. **IDLE timeout:** Most servers drop IDLE after 29 minutes. ImapFlow handles re-IDLE automatically — verify this.
5. **Process model:** IDLE connections live in the Next.js server process. What happens on hot reload / restart? Graceful shutdown needed.
6. **Gmail quirks:** Gmail's IMAP is non-standard in places (labels vs folders, archive = remove INBOX label). Needs testing.

## Out of Scope

- Folder sync (creating/renaming/deleting folders)
- Contact sync
- Calendar integration
- Push notifications to browser (separate feature)
