# Sidebar Fixes: Badge Count + Font Weight

**Date:** 2026-02-16
**Status:** Ready for planning

## What We're Building

Two fixes to the sidebar navigation:

1. **Imbox unread count doesn't update after reading messages** — opening a thread marks messages as read in the DB, but the sidebar badge stays stale because `revalidateTag("sidebar-counts")` is never called.

2. **Active nav item appears bolder than inactive items** — all items use `font-medium`, but the saturated purple active color creates an optical illusion of heavier weight compared to the muted gray inactive color.

## Why This Approach

### Fix 1: Revalidate sidebar counts from thread page server component

- The mark-as-read logic lives in `src/lib/mail/threads.ts` (a utility, not a server action), so we can't call `revalidateTag` there directly.
- Instead, call `revalidateTag("sidebar-counts")` from the thread page's server component after `getThreadMessages()` runs.
- This is the simplest fix — no client-side logic, no cache TTL changes, and it follows the existing pattern used by screener/reply/archive actions.

**Key file:** Thread page server component (wherever it calls `getThreadMessages`)

### Fix 2: Use `font-normal` for all nav items

- Drop from `font-medium` (500) to `font-normal` (400) for all sidebar nav items.
- The color (`text-primary` vs `text-muted-foreground`) and background tint (`bg-primary/10`) already provide sufficient active/inactive distinction.
- Affects both `sidebar.tsx` and `mobile-sidebar.tsx`.

**Key files:**

- `src/components/layout/sidebar.tsx`
- `src/components/layout/mobile-sidebar.tsx`

## Key Decisions

- Revalidate via server component (not client-side refresh or shorter cache TTL)
- `font-normal` for all nav items (not compensating weights or changing colors)

## Open Questions

None — both fixes are straightforward.
