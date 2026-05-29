import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { createRefreshScheduler } from "@/lib/mail/refresh-scheduler";

/**
 * Tests for the coalesced refresh scheduler that stabilizes the mobile PWA.
 *
 * The scheduler funnels every refresh trigger (SSE events, visibility resume,
 * import-progress poll) through one debounced fire so a burst of triggers
 * collapses into a single full `router.refresh()` instead of one per trigger.
 *
 * Modeled with fake timers and an injected `visible` flag — no React, no DOM —
 * consistent with the rest of the test suite (vitest env is "node").
 */

const DELAY = 400;
const MAX_WAIT = 2_000;

describe("createRefreshScheduler", () => {
  let onRefresh: Mock<() => void>;
  let visible: boolean;

  function makeScheduler() {
    return createRefreshScheduler({
      delayMs: DELAY,
      maxWait: MAX_WAIT,
      isVisible: () => visible,
      onRefresh: () => onRefresh(),
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    onRefresh = vi.fn<() => void>();
    visible = true;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("coalesces a burst into a single refresh (R1)", () => {
    const s = makeScheduler();
    for (let i = 0; i < 5; i++) s.schedule();

    // Nothing fires until the debounce window elapses.
    vi.advanceTimersByTime(DELAY - 1);
    expect(onRefresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("fires once per settled burst", () => {
    const s = makeScheduler();

    s.schedule();
    vi.advanceTimersByTime(DELAY);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    s.schedule();
    vi.advanceTimersByTime(DELAY);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("force-fires after maxWait under sustained scheduling (R8)", () => {
    const s = makeScheduler();

    // Schedule continuously at just under the debounce interval so the trailing
    // timer is perpetually reset — a bare debounce would starve forever.
    const step = DELAY - 50; // 350ms < 400ms, so trailing never elapses
    let elapsed = 0;
    while (elapsed < MAX_WAIT) {
      s.schedule();
      vi.advanceTimersByTime(step);
      elapsed += step;
    }

    // maxWait (2000ms) has elapsed during the sustained burst → fired at least once.
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh while hidden (R2)", () => {
    const s = makeScheduler();
    visible = false;

    s.schedule();
    vi.advanceTimersByTime(DELAY);
    expect(onRefresh).not.toHaveBeenCalled();

    // maxWait fire while hidden is also a no-op.
    s.schedule();
    vi.advanceTimersByTime(MAX_WAIT);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("evaluates visibility at fire time, refreshing once on resume (R2/R3)", () => {
    const s = makeScheduler();

    // Hidden: schedule then advance — dropped.
    visible = false;
    s.schedule();
    vi.advanceTimersByTime(DELAY);
    expect(onRefresh).not.toHaveBeenCalled();

    // Resume: schedule once and advance — exactly one catch-up refresh.
    visible = true;
    s.schedule();
    vi.advanceTimersByTime(DELAY);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("cancel() prevents a pending refresh from firing (R5)", () => {
    const s = makeScheduler();

    s.schedule();
    s.cancel();
    vi.advanceTimersByTime(MAX_WAIT * 2);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does nothing when timers advance without a scheduled refresh", () => {
    makeScheduler();
    vi.advanceTimersByTime(MAX_WAIT * 2);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
