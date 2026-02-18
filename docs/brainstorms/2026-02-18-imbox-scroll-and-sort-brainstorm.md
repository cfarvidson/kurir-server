# Brainstorm: Imbox Infinite Scroll & Unread Sorting

**Date:** 2026-02-18
**Status:** Ready for planning

## What We're Building

Two improvements to the Imbox (and Feed/Paper Trail) experience:

1. **Unread threads always on top** — The existing "New For You" / "Previously Seen" split already handles this, but we need to ensure it works correctly when there are 10+ unread threads and the user can't see them all.

2. **Infinite scroll** — Currently only 50 messages load. Users with more messages can't reach older ones. Add cursor-based infinite scroll so scrolling down automatically loads the next batch.

## Why This Approach

### Cursor-based pagination over offset-based

- **Consistency:** New mail arriving between page fetches won't cause duplicates or skipped items (offset-based pagination suffers from this).
- **Performance:** Cursor queries use the existing `[userId, receivedAt(sort: Desc)]` index efficiently. Offset-based gets slower as offset grows.
- **Standard pattern:** Cursor-based is the industry standard for infinite scroll in chronological feeds.

### All categories, not just Imbox

Imbox, Feed, and Paper Trail share the same page structure and query pattern. Implementing infinite scroll once as a shared pattern avoids duplicating work later.

## Key Decisions

- **Cursor strategy:** Use `receivedAt` timestamp + message `id` as cursor (handles messages with identical timestamps).
- **Page size:** 50 threads per batch (matches current load).
- **API route:** New `/api/messages` endpoint accepts cursor, category filter, and returns next batch.
- **Client pattern:** `IntersectionObserver` on a sentinel element near the bottom of the list triggers the next fetch.
- **Sections preserved:** "New For You" and "Previously Seen" sections remain. Infinite scroll loads more within "Previously Seen" since unread messages are finite and shown first.
- **Scope:** Imbox, Feed, and Paper Trail all get infinite scroll.

## Open Questions

- Should we show a loading spinner or skeleton rows while fetching the next page?
- Should there be a "You've reached the end" indicator when all messages are loaded?
- Do we need to handle the case where new unread messages arrive while the user is scrolling (e.g., prepend to the top)?
