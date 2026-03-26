---
title: "feat: Preserve search context on back navigation"
type: feat
date: 2026-02-19
revised: 2026-02-19
---

# Preserve Search Context on Back Navigation

## Overview

When a user searches within a category (Imbox, Feed, Paper Trail, Archive) and clicks into a message from the search results, all return navigation should bring them back to the search results — not the unfiltered category list.

Currently, back links are hardcoded (e.g. `href="/imbox"`) and archive return paths ignore search state. The search query is lost on every navigation into a message detail.

## Proposed Solution

Pass `?q=searchterm` as a URL param on message detail links when navigating from search results. Detail pages read this param and use it to construct search-aware return URLs for the back link, archive button, and keyboard shortcut.

**Why URL params:** Stateless, survives refresh and new tabs, works with browser history, requires minimal code changes. Chosen over `router.back()` (fragile) and React context/sessionStorage (invisible state).

## Acceptance Criteria

- [x] Clicking a message from search results navigates to `/category/{id}?q=searchterm`
- [x] The back link on detail pages returns to `/category?q=searchterm` when `?q=` is present
- [x] Archiving from a detail page (button or "e" key) returns to `/category?q=searchterm`
- [x] Unarchiving from archive detail page returns to `/archive?q=searchterm`
- [x] Normal (non-search) navigation is unchanged — no `?q=` when not searching
- [x] Browser back from detail page returns to search results (already works via history)
- [x] Special characters in search queries survive the URL round-trip

## Scope Decisions

- **Search context only** — not preserving scroll position or infinite-scroll pagination
- **Sent page excluded** — no detail page exists (`sent/[id]/page.tsx` is missing)
- **Back link label unchanged** — keeps existing category name (e.g. "Imbox"), no "Back to search" label
- **Hook-based approach** — `MessageRow` reads `useSearchParams()` directly (it's already a `"use client"` component). No prop threading needed. The search query is ambient URL state, not per-instance data.
- **Keep `<Link href>` for back** — predictable, works with direct URLs; accept minor history stack duplication as tradeoff
- **`q` as param key** — matches existing SearchInput pattern, simple

## Implementation

### Step 1: Read search params in MessageRow

**File:** `src/components/mail/message-list.tsx`

`MessageRow` is already a `"use client"` component. Read `useSearchParams()` to append `?q=` to message detail links when a search is active:

```tsx
import { useSearchParams } from "next/navigation";

// Inside MessageRow
const searchParams = useSearchParams();
const q = searchParams.get("q");
const href = q
  ? `${basePath}/${message.id}?q=${encodeURIComponent(q)}`
  : `${basePath}/${message.id}`;
```

No new props on `MessageList` or `MessageRow`. No changes to category list pages. The URL is already the source of truth for search state (put there by `SearchInput`).

**Note:** `useSearchParams()` may trigger a Suspense boundary. Verify no flash occurs on client navigation — in practice this is fine since search params are available synchronously.

### Step 2: Fix missing basePath on Imbox SearchResults

**File:** `src/app/(mail)/imbox/page.tsx`

Imbox's `SearchResults` is currently missing `basePath` — it works by accident via the prop default. Add it explicitly for consistency:

```tsx
// Before
<MessageList showArchiveAction messages={messages} />

// After
<MessageList showArchiveAction messages={messages} basePath="/imbox" />
```

### Step 3: Accept `searchParams` in detail pages and construct return path

**Files:** `src/app/(mail)/imbox/[id]/page.tsx`, `feed/[id]/page.tsx`, `paper-trail/[id]/page.tsx`, `archive/[id]/page.tsx`

Each detail page needs to:

1. Accept `searchParams: Promise<{ q?: string }>` in its props
2. Construct a `returnPath` that includes `?q=` when present
3. Use `returnPath` in the back link, ArchiveButton, and ArchiveKeyboardShortcut

```tsx
// Example for imbox/[id]/page.tsx
export default async function MessagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const { q } = await searchParams;
  const returnPath = q ? `/imbox?q=${encodeURIComponent(q)}` : "/imbox";

  // Back link
  <Link href={returnPath}>
    <ArrowLeft className="h-4 w-4" />
    Imbox
  </Link>

  // Archive components — note: imbox/[id] currently omits returnPath on ArchiveButton (relies on default)
  <ArchiveButton messageId={id} returnPath={returnPath} />
  <ArchiveKeyboardShortcut messageId={id} returnPath={returnPath} />
}
```

**Note:** `returnPath` is always constructed server-side from a hardcoded path prefix + the `q` param. It is never taken raw from user input, so it is safe for `router.push()`.

**Note:** The archive page (`archive/page.tsx`) does not use a `SearchResults` sub-component — it inlines the search/non-search conditional directly. This doesn't affect the detail page changes but is worth knowing.

### Step 4: Add `returnPath` prop to UnarchiveButton

**File:** `src/components/mail/unarchive-button.tsx`

Currently hardcodes `router.push("/archive")`. Add optional `returnPath` prop matching ArchiveButton's pattern:

```tsx
// Before
interface UnarchiveButtonProps {
  messageId: string;
}
// router.push("/archive");

// After
interface UnarchiveButtonProps {
  messageId: string;
  returnPath?: string;
}
// router.push(returnPath ?? "/archive");
```

Then pass the search-aware `returnPath` from `archive/[id]/page.tsx`.

## Files Changed (7 files)

| File                                       | Change                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `src/components/mail/message-list.tsx`     | `MessageRow` reads `useSearchParams()`, appends `?q=` to link href                    |
| `src/app/(mail)/imbox/page.tsx`            | Fix missing `basePath="/imbox"` on SearchResults `MessageList`                        |
| `src/components/mail/unarchive-button.tsx` | Add `returnPath` prop (matching ArchiveButton pattern)                                |
| `src/app/(mail)/imbox/[id]/page.tsx`       | Accept `searchParams`, construct `returnPath`, pass to back link + archive components |
| `src/app/(mail)/feed/[id]/page.tsx`        | Same                                                                                  |
| `src/app/(mail)/paper-trail/[id]/page.tsx` | Same                                                                                  |
| `src/app/(mail)/archive/[id]/page.tsx`     | Same + pass `returnPath` to UnarchiveButton                                           |

## Edge Cases

- **Special characters in queries:** `encodeURIComponent` handles `&`, `=`, `#`, `+`, Unicode. SearchInput already uses this pattern. Next.js auto-decodes `searchParams` at every boundary, so the encoding chain is consistent.
- **Direct URL with `?q=`:** User bookmarks `/imbox/{id}?q=test` — back link goes to `/imbox?q=test`. Acceptable: search re-executes server-side.
- **Archive last search result:** Returns to empty search results ("No results for 'x'"). Consistent behavior; user can clear the search input.
- **InfiniteMessageList:** Renders `MessageRow` which will call `useSearchParams()`, but in non-search context the URL has no `?q=` param, so `q` is `null` and links remain clean. No issue.

## Testing Plan

Manual verification (no test framework configured):

- [ ] Search in Imbox → open result → back link returns to search
- [ ] Search in Imbox → open result → archive → returns to search
- [ ] Search in Imbox → open result → press "e" → returns to search
- [ ] Search in Archive → open result → unarchive → returns to search
- [ ] Same flows for Feed and Paper Trail
- [ ] Normal (non-search) navigation unchanged — no `?q=` in links
- [ ] Search with special characters (`"quoted phrase"`, `re: #123`)
- [ ] Browser back from detail page restores search

## Review Notes

Plan revised after parallel review by DHH, Kieran, and Simplicity reviewers. Key change: switched from prop-threading (`searchQuery` through MessageList → MessageRow across 10 files) to hook-based (`useSearchParams()` in MessageRow, 7 files). The search query is ambient URL state — reading it from the URL is simpler and more idiomatic than threading it as a prop.

## References

- Brainstorm: `docs/brainstorms/2026-02-19-search-back-navigation-brainstorm.md`
- Search implementation: `docs/solutions/feature-implementations/message-search-with-postgresql-fts.md`
- SearchInput: `src/components/mail/search-input.tsx` (URL param pattern)
- ArchiveButton: `src/components/mail/archive-button.tsx` (returnPath pattern)
