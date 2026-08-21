import { describe, it, expect } from "vitest";
import {
  formatWeekTitle,
  formatDayTitle,
  formatMonthTitle,
  parseDateParam,
  startOfWeekMonday,
  weekDays,
  packTimedEvents,
  civilFromAllDayUtc,
  formatDateParam,
  formatDurationLabel,
  formatFreetimeLabel,
} from "@/lib/calendar/view-time";

describe("calendar view time", () => {
  it("starts the week on Monday and titles August 17-23", () => {
    const sunday = parseDateParam("2026-08-23", "UTC");
    const start = startOfWeekMonday(sunday);
    expect(formatDateParam(start)).toBe("2026-08-17");
    const days = weekDays({ year: 2026, month: 8, day: 20 });
    expect(formatWeekTitle(days)).toBe("August 17-23");
  });

  it("formats day and month masthead titles", () => {
    expect(formatDayTitle({ year: 2026, month: 8, day: 20 })).toBe(
      "Thursday, August 20",
    );
    expect(formatMonthTitle({ year: 2026, month: 8, day: 1 })).toBe(
      "August 2026",
    );
  });

  it("does not zone-shift all-day civil dates", () => {
    expect(civilFromAllDayUtc(new Date("2026-08-20T00:00:00.000Z"))).toEqual({
      year: 2026,
      month: 8,
      day: 20,
    });
  });

  it("packs overlapping timed events into columns", () => {
    const packed = packTimedEvents([
      { id: "a", startMin: 9 * 60, endMin: 11 * 60 },
      { id: "b", startMin: 10 * 60, endMin: 12 * 60 },
      { id: "c", startMin: 13 * 60, endMin: 14 * 60 },
    ]);
    const byId = Object.fromEntries(packed.map((p) => [p.id, p]));
    expect(byId.a.cols).toBe(2);
    expect(byId.b.cols).toBe(2);
    expect(byId.a.col).not.toBe(byId.b.col);
    expect(byId.c.cols).toBe(1);
    expect(byId.c.col).toBe(0);
  });
});

describe("formatDurationLabel", () => {
  it("formats sub-hour durations in minutes", () => {
    expect(formatDurationLabel(45)).toBe("45 min");
  });
  it("formats whole hours", () => {
    expect(formatDurationLabel(60)).toBe("1 h");
    expect(formatDurationLabel(180)).toBe("3 h");
  });
  it("formats half hours with a decimal", () => {
    expect(formatDurationLabel(90)).toBe("1.5 h");
  });
  it("formats other remainders as h + min", () => {
    expect(formatDurationLabel(135)).toBe("2 h 15 min");
  });
});

describe("formatFreetimeLabel", () => {
  it("appends free", () => {
    expect(formatFreetimeLabel(180)).toBe("3 h free");
    expect(formatFreetimeLabel(150)).toBe("2.5 h free");
  });
});
