---
title: Archive Consistency Audit
type: refactor
date: 2026-03-17
---

# Archive Consistency Audit

## Overview

Fix 5 inconsistencies in how archive/unarchive works across imbox, feed, paper-trail, archive, snoozed, and sent pages. The three category pages evolved independently and drifted apart — different capabilities per page, stale data after archiving in some flows, and significant code duplication across detail pages.

## Problem Statement

| # | Issue | Impact |
|---|-------|--------|
| 1 | Feed & Paper Trail lack multi-select | Users can't bulk archive from those pages |
| 2 | Archive actions don't revalidate source page; search results have no optimistic removal | Archived rows stay visible in search results until page reload |
| 3 | Bulk archive skips optimistic removal (no messageIds passed to handler) | Selected rows flash as stale after bulk archive |
| 4 | Detail view navigates before action completes | Archived message briefly reappears in list |
| 5 | 6 detail pages are 95% identical | Maintenance burden, divergent behavior |

## Proposed Solution

### Phase 1: Extract ThreadDetailView (Fix 5)

**Why first:** Creates the shared component that Fixes 1-4 will touch. Also satisfies Phase 0 of the Mobile Reading Experience plan.

Extract a shared `ThreadDetailView` component from the 6 `[id]/page.tsx` files:

```
src/components/mail/thread-detail-view.tsx  (new)
```

**Props:**
- `categoryLabel: string` — "Imbox", "The Feed", "Paper Trail", "Archive", "Snoozed", "Sent"
- `returnPath: string` — base path for back navigation (e.g., "/imbox")
- `actions: React.ReactNode` — slot for ArchiveButton/UnarchiveButton/SnoozeButton
- `messageId: string` — the message/thread ID from params
- `searchQuery?: string` — optional `?q=` param for return path

**Shared logic to move into the component:**
- `getUserInfo` helper (fetches email + timezone) — generalize to always fetch both
- `getThreadMessages` call
- Reply-target resolution (except sent-page special case — stays in page wrapper)
- `\Seen` flag push for newly read messages
- Breadcrumb with back link
- `ThreadPageContent` rendering

**Each page becomes ~10-15 lines:**

```tsx
// src/app/(mail)/imbox/[id]/page.tsx
export default async function ImboxDetailPage({ params, searchParams }) {
  const { id } = await params;
  const q = (await searchParams)?.q;
  return (
    <ThreadDetailView
      messageId={id}
      categoryLabel="Imbox"
      returnPath="/imbox"
      searchQuery={q}
      actions={(messageId, returnPath, timezone) => (
        <>
          <SnoozeButton messageId={messageId} returnPath={returnPath} timezone={timezone} />
          <ArchiveButton messageId={messageId} returnPath={returnPath} />
          <ArchiveKeyboardShortcut messageId={messageId} returnPath={returnPath} action="archive" />
        </>
      )}
    />
  );
}
```

**Sent page:** Computes its own reply target (sent-only-thread logic) and passes it as an override prop.

**Archive page:** Passes `UnarchiveButton` + `ArchiveKeyboardShortcut action="unarchive"` and no `SnoozeButton`.

**Files to modify:**
- `src/app/(mail)/imbox/[id]/page.tsx` — slim wrapper
- `src/app/(mail)/feed/[id]/page.tsx` — slim wrapper
- `src/app/(mail)/paper-trail/[id]/page.tsx` — slim wrapper
- `src/app/(mail)/archive/[id]/page.tsx` — slim wrapper
- `src/app/(mail)/snoozed/[id]/page.tsx` — slim wrapper
- `src/app/(mail)/sent/[id]/page.tsx` — slim wrapper with reply override

### Phase 2: Add Multi-Select to Feed & Paper Trail (Fix 1)

One-line change each:

**Files to modify:**
- `src/app/(mail)/feed/page.tsx` — add `showSelectionToggle={true}`
- `src/app/(mail)/paper-trail/page.tsx` — add `showSelectionToggle={true}`

**Defensive fix while in InfiniteMessageList:**
- `src/components/mail/infinite-message-list.tsx` — pass `showSnoozeAction` to `SelectionActionBar` in the non-sectioned render branch (line ~284) for consistency

### Phase 3: Source Page Revalidation + Search Optimistic Removal (Fix 2)

**Server action change:**

Add optional `sourcePath?: string` parameter to `archiveConversation` and `archiveConversations`. When provided, call `revalidatePath(sourcePath)` alongside the existing `/archive` revalidation.

```typescript
// src/actions/archive.ts
export async function archiveConversation(messageId: string, sourcePath?: string) {
  // ... existing logic ...
  revalidateTag("sidebar-counts");
  revalidatePath("/archive");
  if (sourcePath) revalidatePath(sourcePath);
}
```

Same for `archiveConversations(messageIds: string[], sourcePath?: string)`.

**Callers pass basePath:**
- `MessageRow.doArchive()` in both `message-list.tsx` and `infinite-message-list.tsx` — pass the `basePath` prop through to `archiveConversation`
- `SelectionActionBar.handleArchive()` — accept and pass `sourcePath`

**Client optimistic removal in MessageList (search results):**

Add local state to `MessageList` that tracks optimistically-removed IDs:

```typescript
// src/components/mail/message-list.tsx
const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

const handleArchived = (messageId: string) => {
  setHiddenIds(prev => new Set(prev).add(messageId));
};

// Filter visible messages
const visibleMessages = messages.filter(m => !hiddenIds.has(m.id));
```

Wire `handleArchived` to `MessageRow` via `onArchived` prop.

Add `AnimatePresence mode="popLayout"` wrapper for smooth exit animation, matching `InfiniteMessageList`.

**Files to modify:**
- `src/actions/archive.ts` — add `sourcePath` param to both archive functions
- `src/components/mail/message-list.tsx` — add optimistic removal state + AnimatePresence + wire onArchived
- `src/components/mail/infinite-message-list.tsx` — pass basePath to doArchive calls
- `src/components/mail/selection-action-bar.tsx` — accept and pass sourcePath

### Phase 4: Bulk Archive Optimistic Removal (Fix 3)

**Change callback signature:**

```typescript
// InfiniteMessageList
const handleArchived = (messageIds?: string | string[]) => {
  const ids = Array.isArray(messageIds) ? messageIds : messageIds ? [messageIds] : [];
  if (ids.length === 0) return;

  queryClient.setQueryData(queryKey, (old) => {
    // Resolve all thread keys for the given IDs
    const allMessages = old.pages.flatMap(p => p.messages);
    const threadKeys = new Set(
      ids.map(id => {
        const target = allMessages.find(m => m.id === id);
        return target?.threadId || id;
      })
    );
    // Filter out all messages matching any thread key
    return {
      ...old,
      pages: old.pages.map(page => ({
        ...page,
        messages: page.messages.filter(m => !threadKeys.has(m.threadId || m.id)),
      })),
    };
  });
};
```

**Fix call order in SelectionActionBar:**

```typescript
const handleArchive = () => {
  const idsToArchive = [...selectedMessageIds]; // capture before clearing
  startTransition(async () => {
    await archiveConversations(idsToArchive, sourcePath);
    onQueryInvalidate(idsToArchive); // optimistic removal with IDs
    onComplete(); // clear selection AFTER optimistic removal
  });
};
```

Same fix for `handleUnarchive` — capture IDs, pass to `onQueryInvalidate`, then clear.

**Files to modify:**
- `src/components/mail/infinite-message-list.tsx` — update `handleArchived` to accept `string | string[]`
- `src/components/mail/selection-action-bar.tsx` — capture IDs, reorder calls, pass to `onQueryInvalidate`

### Phase 5: Detail View Archive Timing (Fix 4)

**Approach: Await-then-navigate** — matches existing `SnoozeButton` pattern (`src/components/mail/snooze-button.tsx` lines 24-28).

```typescript
// src/components/mail/archive-button.tsx
const handleArchive = () => {
  startTransition(async () => {
    await archiveConversation(messageId, returnPath);
    router.push(returnPath);
    router.refresh();
  });
};
```

The DB update is fast (~50ms); the IMAP move is already deferred via `after()`. Perceived latency is minimal. Button shows pending state via `useTransition`.

Apply the same pattern to:
- `src/components/mail/archive-button.tsx`
- `src/components/mail/unarchive-button.tsx`
- `src/components/mail/archive-keyboard-shortcut.tsx`

**Files to modify:**
- `src/components/mail/archive-button.tsx` — await action before router.push
- `src/components/mail/unarchive-button.tsx` — same fix
- `src/components/mail/archive-keyboard-shortcut.tsx` — same fix

## Acceptance Criteria

- [x] All 6 detail pages use shared `ThreadDetailView` component
- [x] Feed and Paper Trail have multi-select toggle with bulk archive + bulk snooze
- [x] Archiving from search results instantly hides the row (optimistic) and revalidates source page (server)
- [x] Bulk archive instantly removes all selected rows from the list
- [x] Archiving from detail view navigates only after action completes — no flash-back of archived message
- [x] UnarchiveButton has the same await-then-navigate fix
- [x] `showSnoozeAction` is passed to SelectionActionBar in both sectioned and non-sectioned branches
- [x] Sidebar counts update after every archive/unarchive action (existing — verify not broken)
- [x] Swipe-to-archive on mobile still works in all list views

## Dependencies & Risks

- **Phase 1 (dedup) is prerequisite** — do it first so subsequent phases modify the shared component
- **Mobile Reading Experience overlap** — Phase 1 satisfies Phase 0 of that plan. No duplicate work needed.
- **No test framework** — manual verification required across all pages and interaction modes (click, swipe, keyboard, bulk)
- **Low risk** — all changes are client/server coordination fixes with no schema changes

## References

- Brainstorm: `docs/brainstorms/2026-03-17-archive-consistency-audit-brainstorm.md`
- Mobile Reading Experience plan: `docs/plans/2026-03-17-feat-mobile-reading-experience-plan.md` (Phase 0 overlap)
- SnoozeButton await pattern: `src/components/mail/snooze-button.tsx:24-28`
- Existing `categoryToPath` helper: `src/actions/archive.ts:49`
- Institutional learning on IMAP batching: `docs/solutions/feature-implementations/auto-archive-rejected-screener-messages.md`
