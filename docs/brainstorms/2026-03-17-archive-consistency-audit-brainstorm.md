# Archive Consistency Audit

**Date:** 2026-03-17
**Status:** Ready for planning

## What We're Building

A consistency pass across imbox, feed, paper-trail, and archive pages to ensure archiving works identically everywhere — same actions available, same revalidation, same optimistic UX, and deduplicated detail page code.

## Why This Approach

The three category pages (imbox, feed, paper-trail) evolved independently and drifted apart. Users see different capabilities depending on which page they're on, and some archive flows leave stale data visible.

## Issues to Fix

### 1. Multi-select missing from Feed & Paper Trail
- **Problem:** Imbox has `showSelectionToggle` for bulk archive; Feed and Paper Trail don't.
- **Fix:** Add `showSelectionToggle` prop to `InfiniteMessageList` on feed and paper-trail pages.

### 2. No source page revalidation on archive
- **Problem:** `archiveConversation()` revalidates `/archive` + sidebar counts, but not the source page. Works for `InfiniteMessageList` (optimistic removal), but search results use non-optimistic `MessageList` — archived row stays visible.
- **Fix (two-pronged):**
  - Server: pass source category to `archiveConversation()`, add `revalidatePath()` for it.
  - Client: add optimistic removal to `MessageList` (search results) for instant feel.

### 3. Bulk archive has no optimistic removal
- **Problem:** `SelectionActionBar` calls `handleArchived()` with no messageId, so optimistic cache removal is skipped. Selected rows flash as stale briefly.
- **Fix:** Pass selected messageIds to the optimistic removal handler so bulk archive also removes rows instantly from the react-query cache.

### 4. Detail view archive timing
- **Problem:** `ArchiveButton` calls `router.push(returnPath)` before the server action completes. The message can briefly reappear in the list.
- **Fix:** Coordinate with the list's optimistic update — either pass the archived messageId via a query param/state so the list can immediately hide it, or await the action before navigating.

### 5. Detail page code duplication
- **Problem:** Four `[id]/page.tsx` files are nearly identical (~95% shared code). Only breadcrumb, return path, and archive/unarchive button differ.
- **Fix:** Extract a shared `ThreadDetailView` component. Each `[id]/page.tsx` becomes a thin wrapper (~10 lines) passing category-specific props.

## Key Decisions

- **Server revalidation + client optimistic removal** — belt and suspenders. Server revalidation catches everything; optimistic removal gives instant UX.
- **Shared component over dynamic route** — keeps current URL structure (`/imbox/[id]`, `/feed/[id]`, etc.) while eliminating duplication.
- **Add multi-select to all category pages** — no reason Feed and Paper Trail should be less capable.

## Open Questions

- Should snooze also be audited for the same inconsistencies? (Likely yes, but out of scope for now.)
- Should `unarchiveConversations` (batch) revalidate destination category pages like the single version does?
