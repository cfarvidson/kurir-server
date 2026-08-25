// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";

// Capture what showUndoToast hands to sonner: the `toast.custom` render
// callback (mounted below the way sonner would) and the toast options
// (duration, id, ...).
const { toastCustom, toastDismiss } = vi.hoisted(() => ({
  toastCustom: vi.fn(),
  toastDismiss: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { custom: toastCustom, dismiss: toastDismiss },
}));

import { showUndoToast } from "@/components/mail/undo-toast";

const UNDO_DELAY_MS = 5000;
const SONNER_TOAST_ID = "sonner-toast-id";

/** A deferred promise so the tests control when `holdUntil` settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Call showUndoToast and mount the element its `toast.custom` render callback
 * produces — i.e. render UndoToastContent exactly as sonner would.
 */
function renderToast(opts: {
  holdUntil?: Promise<unknown>;
  onUndo?: () => void;
}) {
  showUndoToast({
    id: "archive-a",
    label: "Archived",
    description: "Subject line",
    holdUntil: opts.holdUntil,
    onUndo: opts.onUndo ?? vi.fn(),
  });
  const call = toastCustom.mock.calls.at(-1)!;
  const renderFn = call[0] as (toastId: string) => ReactElement;
  const sonnerOpts = call[1] as { duration: number; id: string };
  const utils = render(renderFn(SONNER_TOAST_ID));
  return { ...utils, sonnerOpts };
}

/** The progress ring's stroke-dashoffset (0 = full ring shown). */
function ringOffset(container: HTMLElement): number {
  // First circle is the track, second is the progress ring.
  const circles = container.querySelectorAll("circle");
  expect(circles).toHaveLength(2);
  return Number(circles[1].getAttribute("stroke-dashoffset"));
}

function shownSeconds(container: HTMLElement): string {
  return container.querySelector(".tabular-nums")!.textContent ?? "";
}

beforeEach(() => {
  // Fake Date too — useCountdown derives remaining time from Date.now().
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  toastCustom.mockClear();
  toastDismiss.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("UndoToastContent while holdUntil is pending", () => {
  it("freezes the ring at full progress with static seconds", () => {
    const d = deferred<void>();
    const { container } = renderToast({ holdUntil: d.promise });

    expect(shownSeconds(container)).toBe("5");
    expect(ringOffset(container)).toBe(0);

    // Time passing does NOT start the countdown while the archive is in
    // flight — the toast must stay fully actionable.
    act(() => {
      vi.advanceTimersByTime(3 * UNDO_DELAY_MS);
    });
    expect(shownSeconds(container)).toBe("5");
    expect(ringOffset(container)).toBe(0);
    expect(toastDismiss).not.toHaveBeenCalled();
  });

  it("passes duration: Infinity to sonner so its own timer cannot expire the toast", () => {
    const d = deferred<void>();
    const { sonnerOpts } = renderToast({ holdUntil: d.promise });
    expect(sonnerOpts.duration).toBe(Infinity);
    expect(sonnerOpts.id).toBe("archive-a");
  });
});

describe("UndoToastContent after holdUntil settles", () => {
  it("starts the countdown when the promise resolves", async () => {
    const d = deferred<void>();
    const { container } = renderToast({ holdUntil: d.promise });

    await act(async () => {
      d.resolve();
    });

    // Countdown mounted at full...
    expect(shownSeconds(container)).toBe("5");
    // ...and now actually counts down.
    // 2.5s in: the ~66ms tick cadence guarantees the last tick landed
    // between 2442ms and 2500ms, so the display is unambiguously "3".
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(shownSeconds(container)).toBe("3");
    expect(ringOffset(container)).toBeGreaterThan(0);
  });

  it("starts the countdown when the promise rejects (archive failure path)", async () => {
    const d = deferred<void>();
    const { container } = renderToast({ holdUntil: d.promise });

    await act(async () => {
      d.reject(new Error("boom"));
    });

    // 2.5s in: the ~66ms tick cadence guarantees the last tick landed
    // between 2442ms and 2500ms, so the display is unambiguously "3".
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(shownSeconds(container)).toBe("3");
  });

  it("dismisses the toast itself once the countdown completes", async () => {
    const d = deferred<void>();
    renderToast({ holdUntil: d.promise });

    await act(async () => {
      d.resolve();
    });
    expect(toastDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(UNDO_DELAY_MS + 100);
    });
    expect(toastDismiss).toHaveBeenCalledWith(SONNER_TOAST_ID);
  });
});

describe("UndoToastContent unmounted before holdUntil settles", () => {
  it("the active-flag cleanup guard prevents state updates after unmount", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deferred<void>();
    const { unmount } = renderToast({ holdUntil: d.promise });

    unmount();
    await act(async () => {
      d.resolve();
    });

    // No setState-after-unmount noise, no countdown, no self-dismissal.
    expect(consoleError).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2 * UNDO_DELAY_MS);
    });
    expect(toastDismiss).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("UndoToastContent without holdUntil", () => {
  it("counts down immediately and sonner gets a finite duration", () => {
    const { container, sonnerOpts } = renderToast({});

    expect(sonnerOpts.duration).toBe(UNDO_DELAY_MS + 1000);

    // 2.5s in: the ~66ms tick cadence guarantees the last tick landed
    // between 2442ms and 2500ms, so the display is unambiguously "3".
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(shownSeconds(container)).toBe("3");
  });
});

describe("Undo button", () => {
  it("dismisses the toast and fires onUndo — also while held", () => {
    const d = deferred<void>();
    const onUndo = vi.fn();
    const { getByRole } = renderToast({ holdUntil: d.promise, onUndo });

    act(() => {
      getByRole("button", { name: "Undo" }).click();
    });

    expect(toastDismiss).toHaveBeenCalledWith(SONNER_TOAST_ID);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
