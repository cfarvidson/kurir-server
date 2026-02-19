# Brainstorm: Preserve Search Context on Back Navigation

**Date:** 2026-02-19
**Status:** Ready for planning

## What We're Building

When a user searches within a category (Imbox, Feed, Paper Trail, Archive) and clicks into a message from the search results, all "return" navigation should bring them back to their search results — not the unfiltered category list.

This applies to:
- The in-app back link (ArrowLeft) on message detail pages
- The browser's back button
- The return path after actions like archive/unarchive

## Why This Approach

**Chosen: URL params (`?from=search&q=...`) on message detail links**

When navigating from search results to a message detail, the search query is encoded into the URL as query params. The back link and action return paths read these params and construct the correct return URL with the search query preserved.

This was chosen over:
- **`router.back()`** — fragile, breaks on new tabs, archive flows, and direct links
- **React context / sessionStorage** — invisible state that gets stale, doesn't survive refresh or new tabs

URL params are stateless, robust, work with browser history, and require minimal code changes.

## Key Decisions

1. **Scope: search context only** — not preserving scroll position or infinite-scroll pagination state for normal list browsing
2. **Query restoration only** — restoring the `?q=` param is sufficient; scroll position within search results is not needed (top-50 flat list)
3. **All return navigation** — back link, browser back, and post-action returns all respect search context
4. **URL param format** — message detail URLs gain `?q=<searchterm>` when navigated to from search results (e.g. `/imbox/abc123?q=hello`)

## Open Questions

- Should the back link label change to indicate search context (e.g. "← Search results" vs "← Imbox")?
- Should the `from=search` param be used, or is just `?q=` sufficient to infer search origin?

## Affected Files

- `src/components/mail/message-list.tsx` — MessageRow Link href needs to forward search query
- `src/app/(mail)/imbox/[id]/page.tsx` — back link reads searchParams
- `src/app/(mail)/feed/[id]/page.tsx` — same
- `src/app/(mail)/paper-trail/[id]/page.tsx` — same
- `src/app/(mail)/archive/[id]/page.tsx` — same
- `src/components/mail/archive-button.tsx` — returnPath needs to include search query
- `src/components/mail/archive-keyboard-shortcut.tsx` — same
