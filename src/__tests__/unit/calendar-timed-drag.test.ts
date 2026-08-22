import { describe, it, expect } from "vitest";
import {
  TIMED_DRAG_THRESHOLD_PX,
  pointerPastThreshold,
  timedPlacementChanged,
} from "@/components/calendar/timed-drag";

describe("pointerPastThreshold", () => {
  it("ignores sub-threshold jitter", () => {
    expect(pointerPastThreshold(100, 100, 101, 100)).toBe(false);
    expect(
      pointerPastThreshold(100, 100, 100 + TIMED_DRAG_THRESHOLD_PX - 1, 100),
    ).toBe(false);
  });

  it("arms after the pointer travels the threshold", () => {
    expect(
      pointerPastThreshold(100, 100, 100, 100 + TIMED_DRAG_THRESHOLD_PX),
    ).toBe(true);
  });
});

describe("timedPlacementChanged", () => {
  const base = {
    originalDay: "2026-08-20",
    currentDay: "2026-08-20",
    originalStart: 9 * 60,
    originalEnd: 10 * 60,
    startMin: 9 * 60,
    endMin: 10 * 60,
  };

  it("is false when day and snapped times are unchanged", () => {
    expect(timedPlacementChanged(base)).toBe(false);
  });

  it("is true when the day or times actually moved", () => {
    expect(
      timedPlacementChanged({ ...base, currentDay: "2026-08-21" }),
    ).toBe(true);
    expect(
      timedPlacementChanged({ ...base, startMin: 9 * 60 + 15, endMin: 10 * 60 + 15 }),
    ).toBe(true);
    expect(timedPlacementChanged({ ...base, endMin: 10 * 60 + 15 })).toBe(true);
  });
});
