import { describe, it, expect } from "vitest";
import type { CalendarInstanceDTO } from "@/components/calendar/types";
import { pickNextUp, todayRows } from "@/lib/calendar/next-up";

function event(
  title: string,
  startAt: string,
  endAt: string,
  isAllDay = false,
): CalendarInstanceDTO {
  return {
    eventId: title,
    title,
    startAt,
    endAt,
    isAllDay,
    isException: false,
    calendarId: "cal",
    color: "#2f6fb5",
    calendarName: "Work",
    transparency: "busy",
    location: null,
    description: null,
    rrule: null,
    isReadOnly: false,
  };
}

const TZ = "Europe/Stockholm";
// 09:10 in Stockholm (CEST).
const NOW = new Date("2026-09-25T07:10:00Z");

const standup = event("Standup", "2026-09-25T07:30:00Z", "2026-09-25T07:45:00Z");
const lunch = event("Lunch", "2026-09-25T11:00:00Z", "2026-09-25T12:00:00Z");
const breakfast = event("Breakfast", "2026-09-25T06:00:00Z", "2026-09-25T06:30:00Z");
const holiday = event("Holiday", "2026-09-25T00:00:00Z", "2026-09-26T00:00:00Z", true);
const yesterday = event("Yesterday", "2026-09-24T00:00:00Z", "2026-09-25T00:00:00Z", true);

describe("pickNextUp", () => {
  it("picks the first timed event that has not ended, in local time", () => {
    expect(pickNextUp([lunch, holiday, breakfast, standup], NOW, TZ)).toEqual({
      title: "Standup",
      time: "09:30",
      when: "in 20 min",
      color: "#2f6fb5",
    });
  });

  it("says Now for an event in progress and nothing an hour or more out", () => {
    const during = new Date("2026-09-25T07:35:00Z");
    expect(pickNextUp([standup], during, TZ)?.when).toBe("Now");
    expect(pickNextUp([lunch], NOW, TZ)?.when).toBeNull();
  });

  it("returns null when only all-day or finished events remain", () => {
    expect(pickNextUp([holiday, breakfast], NOW, TZ)).toBeNull();
  });
});

describe("todayRows", () => {
  it("lists today's all-day events first, then by start, and marks finished ones", () => {
    expect(
      todayRows([lunch, breakfast, holiday, yesterday], NOW, TZ).map((row) => [
        row.time,
        row.title,
        row.isPast,
      ]),
    ).toEqual([
      ["All day", "Holiday", false],
      ["08:00", "Breakfast", true],
      ["13:00", "Lunch", false],
    ]);
  });
});
