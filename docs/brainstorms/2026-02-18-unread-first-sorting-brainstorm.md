---
topic: Unread-first sorting across all categories
date: 2026-02-18
status: decided
---

# Unread Messages Should Always Show in "New For You"

## Problem

Unread messages that are chronologically old (e.g., received days ago) don't appear in the "New For You" section until the user scrolls far enough for infinite scroll to load that page. The current query fetches messages by `receivedAt DESC` with a limit of 50 — an unread message at position 120 won't show until page 3 loads.

Users expect all unread messages to be visible immediately under "New For You" on first load.

## What We're Building

A two-phase query approach that loads all unread messages upfront, then paginates read messages separately:

1. **Phase 1 (unread)**: Fetch ALL unread messages for the category (`isRead: false`, no limit), sorted by `receivedAt DESC`
2. **Phase 2 (read)**: Fetch read messages with cursor-based pagination (`isRead: true`, limit 50, cursor-based)
3. **Client**: "New For You" shows all unread. "Previously Seen" shows paginated read messages. Infinite scroll applies only to the "Previously Seen" section.

## Why This Approach

- **Guarantees all unread visible immediately** — the whole point
- **Clean separation** — unread and read are independent queries, no mixed sort keys
- **Preserves cursor pagination** — read messages still use the existing `receivedAt + id` cursor, no changes needed
- **Simple client logic** — sections map directly to query results instead of filtering a single mixed list

### Alternatives Considered

1. **Sort-based** (`ORDER BY isRead ASC, receivedAt DESC`): Breaks cursor pagination since cursors assume strict `receivedAt` ordering. Complex cursor math with mixed sort keys.
2. **Pre-count + eager fetch**: Count unread, then fetch `unreadCount + 50`. Same cursor issues. Risk of huge first page.

## Key Decisions

- **Scope**: All categories (Imbox, Feed, Paper Trail) — not just Imbox
- **Feed and Paper Trail get sections**: They'll gain "New For You" / "Previously Seen" headers (currently flat lists)
- **No cap on unread**: Load all unread messages upfront. If there are hundreds, that's acceptable.
- **API change**: The `/api/messages` endpoint needs to support fetching unread-only and read-only modes, or the SSR pages handle the two queries server-side
- **Thread dedup**: Still applies — if a thread has both unread and read messages, it appears in "New For You"

## Open Questions

- Should the API be two separate endpoints/params (e.g., `?readStatus=unread` and `?readStatus=read`), or should the server combine both into a single response?
- When a user reads a message and comes back to the list, should it move from "New For You" to "Previously Seen" immediately (optimistic) or on next full reload?
