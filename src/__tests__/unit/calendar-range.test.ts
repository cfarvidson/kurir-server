import { describe, it, expect } from "vitest";
import {
  overlaps,
  needsOnTheFlyExpand,
  allDayUtcBounds,
  freetimeSpans,
} from "@/lib/calendar/range";

describe("overlaps", () => {
  it("is half-open: touching ends do not overlap", () => {
    expect(
      overlaps(
        new Date("2026-08-20T08:00:00.000Z"),
        new Date("2026-08-20T09:00:00.000Z"),
        new Date("2026-08-20T09:00:00.000Z"),
        new Date("2026-08-20T10:00:00.000Z"),
      ),
    ).toBe(false);
  });
});

describe("needsOnTheFlyExpand", () => {
  const window = {
    from: new Date("2026-06-20T00:00:00.000Z"),
    to: new Date("2028-02-20T00:00:00.000Z"),
  };
  it("is true when the query starts before the window", () => {
    expect(
      needsOnTheFlyExpand(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-31T00:00:00.000Z"),
        window,
      ),
    ).toBe(true);
  });
  it("is false when the query sits inside", () => {
    expect(
      needsOnTheFlyExpand(
        new Date("2026-08-17T00:00:00.000Z"),
        new Date("2026-08-24T00:00:00.000Z"),
        window,
      ),
    ).toBe(false);
  });
});

describe("allDayUtcBounds", () => {
  it("uses exclusive end", () => {
    const b = allDayUtcBounds("2026-08-20", "2026-08-21");
    expect(b.startAt.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(b.endAt.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });
});

describe("freetimeSpans", () => {
  const dayStart = new Date("2026-08-20T07:00:00.000Z");
  const dayEnd = new Date("2026-08-20T21:00:00.000Z");
  it("labels a 3-hour hole and ignores free/cancelled/all-day", () => {
    const spans = freetimeSpans(
      [
        {
          startAt: new Date("2026-08-20T08:00:00.000Z"),
          endAt: new Date("2026-08-20T09:00:00.000Z"),
          isAllDay: false,
          isCancelled: false,
          transparency: "busy",
        },
        {
          startAt: new Date("2026-08-20T12:00:00.000Z"),
          endAt: new Date("2026-08-20T13:00:00.000Z"),
          isAllDay: false,
          isCancelled: false,
          transparency: "busy",
        },
        {
          startAt: new Date("2026-08-20T10:00:00.000Z"),
          endAt: new Date("2026-08-20T11:00:00.000Z"),
          isAllDay: false,
          isCancelled: false,
          transparency: "free",
        },
      ],
      dayStart,
      dayEnd,
      120,
    );
    expect(spans).toEqual([
      {
        startAt: new Date("2026-08-20T09:00:00.000Z"),
        endAt: new Date("2026-08-20T12:00:00.000Z"),
      },
      {
        startAt: new Date("2026-08-20T13:00:00.000Z"),
        endAt: new Date("2026-08-20T21:00:00.000Z"),
      },
    ]);
  });
});
