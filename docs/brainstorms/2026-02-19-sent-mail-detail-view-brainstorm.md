# Sent Mail Detail View

**Date:** 2026-02-19
**Status:** Ready for planning

## Problem

Clicking a sent message in the /sent list results in a 404 — there's no `/sent/[id]/page.tsx` route. All other categories (Imbox, Feed, Paper Trail, Archive) have detail pages, but Sent does not.

## What We're Building

A detail view for sent messages that follows the same patterns as the existing category detail pages, with full thread support.

## Key Decisions

1. **Full thread view** — Opening a sent message shows the entire conversation thread (both received and sent messages), not just the isolated sent message.

2. **Reply composer shown** — The reply composer appears at the bottom, same as Imbox. Users can continue the conversation directly from the sent view.

3. **Thread-collapsed list with current message expanded** — The sent list should use thread collapsing (like Imbox), grouping messages by conversation. When viewing a thread, the current/clicked message should be expanded while others are collapsed.

4. **Back navigates to /sent** — The back button always returns to /sent, not to the thread's "home" category.

## Open Questions

- How should the "To" field display in the sent list? Currently shows sender info — for sent messages, the recipient is more relevant.
- Should sent-only threads (no replies received yet) look different from threads that have replies?

## Approach

Follow the existing pattern from `/imbox/[id]/page.tsx` — reuse `ThreadPageContent` component which already handles showing "You" for messages from the current user. The main work is:

1. Create the missing `/sent/[id]/page.tsx` route
2. Update the sent list page to use thread collapsing
3. Ensure thread retrieval works correctly when entering from a sent message
