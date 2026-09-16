import { describe, it, expect } from "vitest";
import { listFollowUpPresets } from "@/lib/mail/follow-up-presets";

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

function until(now: Date, id: string): Date | undefined {
  return listFollowUpPresets(now, TZ).find((preset) => preset.id === id)
    ?.until;
}

describe("listFollowUpPresets", () => {
  const now = utc(2026, 9, 7, 15, 30);

  it("pins tomorrow, the day after, and in 3 days to 08:00", () => {
    expect(until(now, "oneDay")).toEqual(utc(2026, 9, 8, 8, 0));
    expect(until(now, "twoDays")).toEqual(utc(2026, 9, 9, 8, 0));
    expect(until(now, "threeDays")).toEqual(utc(2026, 9, 10, 8, 0));
  });

  it("keeps a week and two weeks at 08:00", () => {
    expect(until(now, "oneWeek")).toEqual(utc(2026, 9, 14, 8, 0));
    expect(until(now, "twoWeeks")).toEqual(utc(2026, 9, 21, 8, 0));
  });

  it("uses the same labels as iOS/macOS", () => {
    expect(listFollowUpPresets(now, TZ).map((preset) => preset.label)).toEqual([
      "Tomorrow",
      "Wednesday",
      "Thursday",
      "In a week",
      "In 2 weeks",
    ]);
  });
});
