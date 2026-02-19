---
title: "feat: Unread-first sorting via sort order change"
type: feat
date: 2026-02-18
---

# feat: Unread-first sorting via sort order change

## Overview

Unread messages that are chronologically old don't appear in "New For You" until the user scrolls far enough for infinite scroll to load that page. Fix by changing the query sort order to put unread messages first.

## Problem Statement

The current `getMessages()` fetches messages sorted by `receivedAt DESC` regardless of read status. The client-side "New For You" / "Previously Seen" split only works on loaded pages. An unread message at position 120 is invisible until the user scrolls to page 3.

## Proposed Solution

Change the sort order to `isRead ASC, receivedAt DESC, id DESC`. This puts all unread messages (isRead=false → 0) before read messages (isRead=true → 1), with each group sorted by date. The existing client-side section split in `InfiniteMessageList` already handles this correctly.

**Review-driven simplification**: The original plan proposed a two-phase query (6+ files, ~200 lines). Five review agents identified that a sort-order change achieves the same result in ~20 lines in 1 file, with zero API, component, or page changes.

### Scope

- Applies to all three categories (Imbox, Feed, Paper Trail) via the shared `getMessages()` function
- Feed and Paper Trail gain "New For You" / "Previously Seen" sections by passing `showSections={true}`
- Search mode stays unchanged (flat list)

## Technical Approach

### 1. Change sort order in `getMessages()`

File: `src/lib/mail/messages.ts` (line 64)

```typescript
// Before:
orderBy: [{ receivedAt: "desc" }, { id: "desc" }],

// After:
orderBy: [{ isRead: "asc" }, { receivedAt: "desc" }, { id: "desc" }],
```

### 2. Update cursor encoding to include `isRead`

File: `src/lib/mail/messages.ts`

The cursor must encode `isRead` for stable pagination across the read/unread boundary:

```typescript
// encodeCursor: prefix with 0 (unread) or 1 (read)
export function encodeCursor(msg: {
  isRead: boolean;
  receivedAt: Date;
  id: string;
}): string {
  return `${msg.isRead ? "1" : "0"}_${msg.receivedAt.toISOString()}_${msg.id}`;
}
```

Update `parseCursor` to decode the three-part cursor and build the correct WHERE clause for the `isRead ASC, receivedAt DESC, id DESC` sort:

- If cursor is at an unread message: next page gets remaining unread (older) + all read
- If cursor is at a read message: next page gets remaining read (older)

### 3. Enable sections for Feed and Paper Trail

Files: `src/app/(mail)/feed/page.tsx`, `src/app/(mail)/paper-trail/page.tsx`

Add `showSections={true}` to the `InfiniteMessageList` component in both pages (already exists in Imbox).

### 4. (No other changes needed)

- No API route changes
- No component prop changes
- No new data-fetching patterns
- No new indexes required (existing `@@index([userId, isInImbox, isRead])` supports the sort)

## Acceptance Criteria

- [x] `getMessages()` sorts by `isRead ASC, receivedAt DESC, id DESC`
- [x] Cursor encoding includes `isRead` status for stable pagination
- [x] Cursor parsing handles the three-part format and builds correct WHERE clause
- [x] Unread messages appear before read messages in all categories
- [x] "New For You" section shows unread messages on first page load
- [x] Infinite scroll continues to work across the unread→read boundary
- [x] Feed and Paper Trail show "New For You" / "Previously Seen" sections
- [x] Search mode remains unchanged (flat list, no sections)
- [x] TypeScript compiles with zero errors

## Implementation Checklist

- [x] 1. Change `orderBy` in `getMessages()` in `src/lib/mail/messages.ts`
- [x] 2. Update `encodeCursor()` to include `isRead` prefix
- [x] 3. Update `parseCursor()` to handle three-part cursor with isRead-aware WHERE clause
- [x] 4. Add `showSections={true}` to Feed page component
- [x] 5. Add `showSections={true}` to Paper Trail page component
- [x] 6. Run `npx tsc --noEmit` to verify zero TypeScript errors

## References

- Brainstorm: `docs/brainstorms/2026-02-18-unread-first-sorting-brainstorm.md`
- Current implementation: `src/lib/mail/messages.ts`, `src/components/mail/infinite-message-list.tsx`
- Related PR: #2 (infinite scroll implementation)
- Prisma schema indexes: `prisma/schema.prisma:210-218`
