import { describe, it, expect } from "vitest";
import {
  listSnoozePresets,
  defaultCustomSnooze,
  buildDateInTimezone,
} from "@/lib/mail/snooze-presets";

const TZ = "UTC";

function utc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
}

function ids(now: Date): string[] {
  return listSnoozePresets(now, TZ).map((preset) => preset.id);
}

function until(now: Date, id: string): Date | null {
  return listSnoozePresets(now, TZ).find((preset) => preset.id === id)
    ?.until ?? null;
}

describe("listSnoozePresets", () => {
  it("snoozes later today three hours out", () => {
    const now = utc(2026, 7, 24, 10, 0);
    expect(until(now, "laterToday")).toEqual(utc(2026, 7, 24, 13, 0));
    expect(
      listSnoozePresets(now, TZ).find((p) => p.id === "laterToday")?.label,
    ).toBe("Later today");
  });

  it("snoozes tomorrow, the day after, and in 3 days at 08:00", () => {
    const now = utc(2026, 7, 24, 10, 0);
    expect(until(now, "tomorrow")).toEqual(utc(2026, 7, 25, 8, 0));
    expect(until(now, "dayAfter")).toEqual(utc(2026, 7, 26, 8, 0));
    expect(until(now, "inThreeDays")).toEqual(utc(2026, 7, 27, 8, 0));
    expect(
      listSnoozePresets(now, TZ).find((p) => p.id === "tomorrow")?.label,
    ).toBe("Tomorrow");
    expect(
      listSnoozePresets(now, TZ).find((p) => p.id === "dayAfter")?.label,
    ).toBe("Sunday");
    expect(
      listSnoozePresets(now, TZ).find((p) => p.id === "inThreeDays")?.label,
    ).toBe("Monday");
  });

  it("snoozes next week on the coming Monday at 08:00", () => {
    const now = utc(2026, 7, 24, 10, 0);
    expect(until(now, "nextWeek")).toEqual(utc(2026, 7, 27, 8, 0));
  });

  it("snoozes this weekend from Friday to Saturday 08:00", () => {
    const now = utc(2026, 7, 24, 15, 30);
    expect(until(now, "weekend")).toEqual(utc(2026, 7, 25, 8, 0));
  });

  it("rolls this weekend from Saturday to the next Saturday", () => {
    const now = utc(2026, 7, 25, 10, 0);
    expect(until(now, "weekend")).toEqual(utc(2026, 8, 1, 8, 0));
  });

  it("rolls this weekend from Sunday to the next Saturday", () => {
    const now = utc(2026, 7, 26, 10, 0);
    expect(until(now, "weekend")).toEqual(utc(2026, 8, 1, 8, 0));
  });

  it("snoozes this weekend from Monday to the coming Saturday", () => {
    const now = utc(2026, 7, 27, 9, 0);
    expect(until(now, "weekend")).toEqual(utc(2026, 8, 1, 8, 0));
  });

  it("keeps tomorrow, the day after, and in 3 days in chronological order from Monday", () => {
    expect(ids(utc(2026, 7, 27, 9, 0))).toEqual([
      "laterToday",
      "tomorrow",
      "dayAfter",
      "inThreeDays",
      "weekend",
      "nextWeek",
      "custom",
    ]);
  });

  it("sorts colliding weekend and next-week slots after the matching day presets", () => {
    expect(ids(utc(2026, 7, 24, 10, 0))).toEqual([
      "laterToday",
      "tomorrow",
      "weekend",
      "dayAfter",
      "inThreeDays",
      "nextWeek",
      "custom",
    ]);
  });

  it("keeps this weekend on Saturday instead of hiding it", () => {
    expect(ids(utc(2026, 7, 25, 10, 0))).toContain("weekend");
  });

  it("uses the user timezone for morning presets, not the machine zone", () => {
    const now = utc(2026, 7, 27, 9, 0);
    const stockholm = listSnoozePresets(now, "Europe/Stockholm");
    expect(stockholm.find((p) => p.id === "tomorrow")?.until).toEqual(
      utc(2026, 7, 28, 6, 0),
    );
  });
});

describe("defaultCustomSnooze", () => {
  it("defaults to tomorrow morning at 08:00", () => {
    expect(defaultCustomSnooze(utc(2026, 7, 24, 15, 0), TZ)).toEqual({
      date: "2026-07-25",
      time: "08:00",
    });
  });
});

describe("buildDateInTimezone", () => {
  it("builds an instant for a wall time in a named zone", () => {
    const date = buildDateInTimezone("America/New_York", 2026, 6, 24, 8, 0);
    expect(date.toISOString()).toBe("2026-07-24T12:00:00.000Z");
  });
});
