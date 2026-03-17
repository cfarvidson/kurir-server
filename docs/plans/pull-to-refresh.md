# Plan: Pull-to-Refresh for iOS PWA

## Problem
When Kurir is added to the iPhone homescreen as a PWA (`display: standalone`), the native Safari pull-to-refresh is disabled. Users have no way to manually refresh the mail list.

## Solution
Build a custom pull-to-refresh component using touch events that triggers `router.refresh()`. Keep it simple — no framer-motion dependency needed for this (plain touch events are lighter and avoid conflicts with the existing horizontal swipe gestures).

## Architecture

### New Component: `PullToRefresh`
**File:** `src/components/mail/pull-to-refresh.tsx`

A wrapper component that:
1. Listens for `touchstart` / `touchmove` / `touchend` on the scroll container
2. Only activates when `scrollTop === 0` (at the top of the list)
3. Shows a spinner indicator that pulls down with the finger
4. On release past threshold (60px), triggers refresh
5. Animates back to resting position

**Key behaviors:**
- Only active on touch devices (no-op on desktop)
- Must not conflict with horizontal swipe gestures (SwipeableRow) — only activate on predominantly vertical pulls
- Uses CSS transforms for smooth 60fps animation (no layout thrashing)
- Shows a rotating `RefreshCw` icon from lucide-react

### Integration Point
Wrap the content inside `<main>` in the mail layout (`src/app/(mail)/layout.tsx`):

```tsx
<main className="flex-1 overflow-auto">
  <PullToRefresh>
    {children}
  </PullToRefresh>
</main>
```

The `PullToRefresh` component needs to detect when the scroll container (its parent `<main>`) is at scroll position 0, then capture vertical pull gestures.

### Refresh Action
Call `router.refresh()` — this re-runs all RSC server components, fetching fresh data from the database. This is the same mechanism used by the `visibilitychange` handler in `AutoSync`.

## Implementation Steps

1. **Create `src/components/mail/pull-to-refresh.tsx`**
   - Client component with touch event handlers
   - Tracks pull distance via `useState` + `useRef`
   - CSS transition for snap-back animation
   - `RefreshCw` icon with rotation animation while refreshing
   - Direction lock: ignore if horizontal movement > vertical (prevents conflict with SwipeableRow)

2. **Integrate in `src/app/(mail)/layout.tsx`**
   - Import and wrap `{children}` with `<PullToRefresh>`
   - The component needs access to `useRouter` so it must be a client component — keep the layout as server component and just add the client wrapper

3. **CSS: prevent native overscroll bounce**
   - Add `overscroll-behavior-y: contain` to the scroll container to prevent double-bounce on Android Chrome which has its own pull-to-refresh

## Edge Cases
- **Horizontal swipe conflict:** Direction-lock the gesture. If `|deltaX| > |deltaY|` in the first 10px of movement, abort the pull-to-refresh and let SwipeableRow handle it.
- **Already refreshing:** Debounce — ignore new pulls while a refresh is in progress.
- **Fast scroll up:** Only trigger when `scrollTop <= 0` AND touch is moving down. Momentum scrolling to top should not trigger it.
- **Message detail pages:** Pull-to-refresh works everywhere inside `(mail)/layout.tsx` — this is fine, refreshing a detail page re-fetches that message too.

## Non-Goals
- Offline caching / service worker changes
- Haptic feedback (would need native API)
- Custom pull distances per page
