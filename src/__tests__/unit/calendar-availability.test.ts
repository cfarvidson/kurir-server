import { describe, it, expect } from "vitest";
import {
  DEFAULT_AVAILABILITY,
  availabilityForDay,
  availabilitySchema,
  resolveAvailability,
  weekdayIndex,
} from "@/lib/calendar/availability";

const week = (weekend: { on: boolean; start: number; end: number }) => ({
  days: [
    ...Array.from({ length: 5 }, () => ({ on: true, start: 420, end: 1260 })),
    weekend,
    weekend,
  ],
});

describe("resolveAvailability", () => {
  it("falls back to 07-21 every day when nothing is stored", () => {
    expect(resolveAvailability(null)).toEqual(DEFAULT_AVAILABILITY);
    expect(DEFAULT_AVAILABILITY.days).toHaveLength(7);
    expect(DEFAULT_AVAILABILITY.days[0]).toEqual({
      on: true,
      start: 420,
      end: 1260,
    });
  });

  it("falls back to the default for a malformed row", () => {
    expect(resolveAvailability({ days: [] })).toEqual(DEFAULT_AVAILABILITY);
    expect(resolveAvailability("07-21")).toEqual(DEFAULT_AVAILABILITY);
  });

  it("keeps a valid stored value", () => {
    const value = week({ on: true, start: 540, end: 1200 });
    expect(resolveAvailability(value)).toEqual(value);
  });
});

describe("availabilitySchema", () => {
  it("rejects a window that ends before it starts", () => {
    expect(
      availabilitySchema.safeParse(week({ on: true, start: 600, end: 540 }))
        .success,
    ).toBe(false);
  });

  it("rejects times off the 30-minute grid", () => {
    expect(
      availabilitySchema.safeParse(week({ on: true, start: 545, end: 1200 }))
        .success,
    ).toBe(false);
  });

  it("accepts a day that is off", () => {
    expect(
      availabilitySchema.safeParse(week({ on: false, start: 540, end: 1200 }))
        .success,
    ).toBe(true);
  });
});

describe("availabilityForDay", () => {
  it("counts Monday as the first day", () => {
    // 2026-09-21 is a Monday, 2026-09-27 a Sunday.
    expect(weekdayIndex({ year: 2026, month: 9, day: 21 })).toBe(0);
    expect(weekdayIndex({ year: 2026, month: 9, day: 27 })).toBe(6);
  });

  it("returns the weekend window on a Saturday", () => {
    const value = week({ on: true, start: 540, end: 1200 });
    expect(availabilityForDay(value, { year: 2026, month: 9, day: 26 })).toEqual(
      { on: true, start: 540, end: 1200 },
    );
  });
});
