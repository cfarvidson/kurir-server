---
title: "fix: Sidebar badge count staleness and font weight inconsistency"
type: fix
date: 2026-02-16
---

# fix: Sidebar badge count staleness and font weight inconsistency

Two sidebar bugs: the Imbox unread count doesn't update after reading messages, and the active nav item appears visually bolder than inactive items due to color-weight optical illusion.

## Acceptance Criteria

- [x] Opening a thread and navigating back shows updated Imbox unread count in sidebar
- [x] All sidebar nav items appear the same font weight regardless of active state
- [x] Badge counts on Screener/Imbox still display correctly
- [x] Both desktop and mobile sidebars are updated consistently

## Fix 1: Revalidate sidebar counts after mark-as-read

**Root cause:** `getThreadMessages()` in `src/lib/mail/threads.ts:142-148` marks unread messages as read via `db.message.updateMany()`, but never invalidates the `"sidebar-counts"` cache. The sidebar layout uses `unstable_cache` with 30s TTL and the `"sidebar-counts"` tag.

**Approach:** Add `revalidateTag("sidebar-counts")` inside `getThreadMessages()` in `src/lib/mail/threads.ts`, right after the `updateMany` call on line 148, inside the existing `if (unreadIds.length > 0)` guard. This co-locates the cache invalidation with the mutation that causes staleness, only fires when messages actually change from unread to read, and requires no changes to page components.

### Changes

#### `src/lib/mail/threads.ts`

- Add import: `import { revalidateTag } from "next/cache";`
- After line 148 (`data: { isRead: true }`), inside the `if (unreadIds.length > 0)` block, add: `revalidateTag("sidebar-counts");`

## Fix 2: Normalize nav item font weight

**Root cause:** All nav items use `text-sm font-medium` (weight 500). The active item uses `text-primary` (saturated purple) while inactive items use `text-muted-foreground` (gray). Higher-saturation colors appear optically heavier at the same font weight.

**Approach:** Change nav item links from `font-medium` to `font-normal` (weight 400). The color + background tint provides sufficient active/inactive distinction. Keep `font-medium` on badge counts and the Compose button (small text benefits from medium weight). Keep `font-semibold` on the logo.

### Changes

#### `src/components/layout/sidebar.tsx`

| Line | Element         | Change                        |
| ---- | --------------- | ----------------------------- |
| 52   | Nav links       | `font-medium` → `font-normal` |
| 75   | Settings link   | `font-medium` → `font-normal` |
| 86   | Sign out button | `font-medium` → `font-normal` |

Keep `font-medium` on line 61 (badge count).

#### `src/components/layout/mobile-sidebar.tsx`

| Line | Element         | Change                        |
| ---- | --------------- | ----------------------------- |
| 122  | Nav links       | `font-medium` → `font-normal` |
| 146  | Settings link   | `font-medium` → `font-normal` |
| 157  | Sign out button | `font-medium` → `font-normal` |

Keep `font-medium` on line 103 (Compose button) and line 131 (badge count).

## Context

- Brainstorm: `docs/brainstorms/2026-02-16-sidebar-fixes-brainstorm.md`
- Existing revalidation pattern: `src/actions/senders.ts:46`, `src/actions/archive.ts:115`, `src/actions/reply.ts:88`
- Sidebar cache setup: `src/app/(mail)/layout.tsx:10-22`
