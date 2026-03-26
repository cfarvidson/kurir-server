# Learnings: Screener fetchBody Race Condition Fix Verification

**Date:** 2026-03-20
**Task:** Verify Task #3 — screener preview bug fix (AbortController race condition)

---

## What Was Fixed

`fetchBody` in `screener-view.tsx` had a race condition: when the user screened out sender A
while its body fetch was in-flight, the `finally` block would call `setPreviewLoading(false)`
after sender B's card was already rendered — stomping B's loading state.

**Root causes (pre-fix):**

1. `useCallback` deps included `bodyCache` — new closure captured on every cache update
2. `finally` always called `setPreviewLoading(false)` regardless of whether the fetch was stale
3. Reset `useEffect` only reset state, never aborted the in-flight fetch

## The Fix (verified correct)

- `abortControllerRef` stores the current in-flight `AbortController`
- `bodyCacheRef` mirrors `bodyCache` as a ref — removes `bodyCache` from closure deps, making `fetchBody` stable with `[]` deps
- Reset `useEffect` calls `abortControllerRef.current?.abort()` before resetting state
- `fetchBody` creates a new `AbortController` per call, aborts the previous one
- Replaced `finally` with explicit `setPreviewLoading(false)` in success/error paths only
- `AbortError` caught and returns early — never touches `previewLoading` or `previewError`

## Testing Strategy

Since `screener-view.tsx` is a React component with heavy UI rendering, it can't be imported in
vitest's node environment. Following the established pattern in this codebase (screener-preview,
screener-edge-cases tests), we modelled the fix as a **pure async state machine** — no React,
no DOM. The pure model faithfully mirrors the component's async logic.

Key insight: when writing abort-aware mock fetches, the `Promise` must actively listen on the
abort signal and reject with `DOMException("Aborted", "AbortError")`. A plain `mockResolvedValue`
does NOT respect the signal — it resolves regardless of abort. Two tests initially failed because
of this oversight; fixed by wrapping resolvers in signal-aware promise factories.

## Test File Added

`src/__tests__/unit/screener-fetch-race.test.ts` — 19 tests covering:

- AbortController lifecycle (created per fetch, previous one aborted, signal passed to fetch)
- AbortError silencing (no previewError, no previewLoading false from abort path)
- resetPreview aborts in-flight fetch (correct synchronous state reset)
- Race condition scenarios (stale fetch, rapid 3-sender screen-out, screen-out with preview open)
- bodyCacheRef closure (no re-fetch on cache hit, independent fetches for different IDs)
- Success/error state transitions (loading→false, error set correctly, error cleared on retry)

## Regression Confirmation

All 5 screener test files pass (140 tests total). The 28 pre-existing failures across 9 other
test files are unchanged — confirmed by running baseline before/after (stash showed same count).

## Patterns to Reuse

- **abort-aware fake fetch helper**: when testing AbortController logic, the mock must actively
  reject on signal abort — not just resolve. Pattern:
  ```ts
  function abortAwareFetch(id, signal, body) {
    return new Promise((res, rej) => {
      if (signal.aborted) {
        rej(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => rej(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
      Promise.resolve().then(() => {
        if (!signal.aborted) res(body);
      });
    });
  }
  ```
- **ref mirroring pattern**: `bodyCacheRef.current = bodyCache` on every render lets you read
  latest state in callbacks without stale closures, enabling empty dep arrays on `useCallback`.

## Edge Cases Not Covered by Tests (by design)

- `togglePreview` still lists `latestMessage` as a dep (correct — it needs the current message ID)
- The `isPreviewOpen` dep in `togglePreview` is correct and cannot be removed
- Undo flow after screen-out: undo restores the previous sender list but bodyCache is preserved
  (cross-sender caching is intentional — fetched bodies survive card changes)
