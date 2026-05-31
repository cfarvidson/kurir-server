import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatSnoozeUntil } from "@/lib/date";

describe("formatSnoozeUntil", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("labels a time later the same calendar day as 'today'", () => {
    // 2026-05-31 14:00 local
    vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));
    const until = new Date(2026, 4, 31, 18, 0, 0); // same day, 4h later
    expect(formatSnoozeUntil(until)).toMatch(/^today /);
  });

  it("labels next-morning snooze set in the evening as 'tomorrow', not 'today'", () => {
    // Regression: a < 24h snooze that crosses midnight must read "tomorrow".
    // 2026-05-31 22:00 local
    vi.setSystemTime(new Date(2026, 4, 31, 22, 0, 0));
    const until = new Date(2026, 5, 1, 8, 0, 0); // next day 08:00, only 10h later
    expect(formatSnoozeUntil(until)).toMatch(/^tomorrow /);
  });

  it("uses 'in Nm' for sub-hour snoozes", () => {
    vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));
    const until = new Date(2026, 4, 31, 14, 30, 0);
    expect(formatSnoozeUntil(until)).toBe("in 30m");
  });

  it("uses the weekday name for dates later this week", () => {
    vi.setSystemTime(new Date(2026, 4, 31, 9, 0, 0));
    const until = new Date(2026, 5, 3, 9, 0, 0); // 3 days out
    // Derive the expected weekday so the test survives changes to the constants.
    const weekday = until.toLocaleDateString("en-US", { weekday: "long" });
    expect(formatSnoozeUntil(until)).toMatch(new RegExp(`^${weekday} `));
  });

  it("returns 'waking up...' for a date in the past", () => {
    vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));
    const until = new Date(2026, 4, 31, 13, 0, 0); // 1h ago
    expect(formatSnoozeUntil(until)).toBe("waking up...");
  });

  it("uses an absolute month/day date for dates more than a week out", () => {
    vi.setSystemTime(new Date(2026, 4, 31, 9, 0, 0));
    const until = new Date(2026, 5, 15, 9, 0, 0); // 15 days out
    const result = formatSnoozeUntil(until);
    expect(result).not.toMatch(/^(today|tomorrow|in )/);
    expect(result).toContain("Jun");
  });
});
