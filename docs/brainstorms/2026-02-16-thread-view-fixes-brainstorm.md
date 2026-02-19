# Thread View Fixes: Sort Order & Quoted Text

**Date:** 2026-02-16
**Status:** Ready for planning

## What We're Building

Two improvements to the thread/conversation detail view (`/imbox/[id]`):

1. **Fix message ordering** — Messages sort by `receivedAt`, which for sent messages reflects the IMAP Sent folder's `internalDate` rather than when the message was composed. After IMAP sync deduplication replaces the local placeholder, the Sent folder timestamp can shift the message out of position. Fix by sorting on `sentAt ?? receivedAt` for all messages — `sentAt` is the envelope `Date:` header and is the most accurate timestamp for when a message was written.

2. **Collapse quoted text in replies** — When viewing a thread, each reply currently shows the full body including `> quoted` lines from earlier messages. Since those messages are already visible in the thread, this is redundant. Collapse quoted blocks behind a toggle ("Show quoted text").

## Why These Approaches

### Sort by `sentAt ?? receivedAt` for all messages

- Simple: change the sort comparator in `getThreadMessages()` to use `sentAt` with `receivedAt` fallback
- Consistent: same logic for incoming and outgoing — `sentAt` (envelope `Date:` header) is the most accurate "when was this written" timestamp for both
- Uses existing data — `sentAt` is already stored on every message
- Root cause: IMAP sync deduplication replaces local sent placeholder (correct `receivedAt`) with Sent folder copy (potentially drifted `receivedAt`)
- Edge case: `sentAt` can be `null` if `Date:` header missing — fallback to `receivedAt` handles this

### UI-level quote collapsing

- No data model changes — detection happens at render time
- Reversible — user can toggle to see full quoted text if needed
- Handles both plain text (`>` prefix lines) and HTML (`<blockquote>`) emails
- Preferred over sync-time parsing (would need re-sync) and CSS-only (wouldn't handle plain text)

## Key Decisions

- **Sort field**: Use `sentAt ?? receivedAt` for all messages. Applies uniformly — no need to detect sent vs received.
- **Quote detection**: Detect `>` prefixed lines in plain text and `<blockquote>` in HTML. Also detect "On DATE, NAME wrote:" attribution lines.
- **Collapse UI**: Show a clickable "..." or "Show quoted text" element. Collapsed by default.
- **Scope**: Thread detail view only — snippets and list view are unaffected.

## Open Questions

- Should the toggle state persist (e.g., once expanded, stay expanded on re-render)?
- How to handle deeply nested quotes (quote within quote)?
