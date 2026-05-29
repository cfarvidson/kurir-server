/**
 * Coalesced refresh scheduler.
 *
 * The mobile PWA freezes when many refresh triggers (SSE events from IMAP
 * IDLE, an EventSource reconnect replaying buffered events on resume, or the
 * 2s import-progress poll) each fire a full `router.refresh()` — every call
 * refetches the entire RSC tree. This scheduler funnels all of those triggers
 * through one debounced fire so a burst collapses into a single refresh.
 *
 * Three properties matter:
 *  - **Coalescing:** a trailing debounce so a burst settles into one fire.
 *  - **No starvation:** a `maxWait` cap force-fires once even under sustained
 *    sub-`delayMs` scheduling (e.g. continuous IDLE churn), so the UI can't be
 *    held stale for the entire duration of a long burst.
 *  - **Skip while hidden:** the visibility check runs at fire time, so nothing
 *    refreshes in the background (the resume handler schedules a catch-up).
 *
 * `isVisible` and `onRefresh` are invoked at fire time, never frozen at
 * construction — callers pass closures that read live values (e.g. a router
 * ref) so a once-constructed scheduler never captures stale dependencies.
 *
 * Pure and DOM-free: visibility is injected, so this is unit-testable in the
 * `node` test environment with fake timers.
 */

export interface RefreshScheduler {
  /** Request a refresh; coalesces with any already-pending request. */
  schedule: () => void;
  /** Cancel any pending refresh (use in unmount cleanup). */
  cancel: () => void;
}

export interface RefreshSchedulerOptions {
  /** Trailing debounce window in ms — a burst within this window fires once. */
  delayMs: number;
  /** Upper bound: force-fire after this long even under sustained scheduling. */
  maxWait: number;
  /** Read at fire time — the refresh is skipped (and dropped) when this is false. */
  isVisible: () => boolean;
  /** Read at fire time — the actual refresh side effect. */
  onRefresh: () => void;
}

export function createRefreshScheduler(
  opts: RefreshSchedulerOptions,
): RefreshScheduler {
  const { delayMs, maxWait, isVisible, onRefresh } = opts;

  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (trailingTimer) {
      clearTimeout(trailingTimer);
      trailingTimer = null;
    }
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  };

  const fire = () => {
    clearTimers();
    // Skip while hidden — the visibility/resume handler will schedule a fresh
    // catch-up refresh when the tab becomes visible again.
    if (!isVisible()) return;
    onRefresh();
  };

  const schedule = () => {
    // Reset the trailing timer so a burst keeps coalescing...
    if (trailingTimer) clearTimeout(trailingTimer);
    trailingTimer = setTimeout(fire, delayMs);
    // ...but cap the total wait so sustained scheduling can't starve the fire.
    if (!maxWaitTimer) {
      maxWaitTimer = setTimeout(fire, maxWait);
    }
  };

  return { schedule, cancel: clearTimers };
}
