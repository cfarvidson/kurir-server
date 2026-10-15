import { describe, it, expect } from "vitest";
import type { CalendarInstanceDTO } from "@/components/calendar/types";
import { headerNextUp } from "@/components/calendar/header-model";
import { laterToday, pickNextUp, todayRows } from "@/lib/calendar/next-up";

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

const standup = event(
  "Standup",
  "2026-09-25T07:30:00Z",
  "2026-09-25T07:45:00Z",
);
const lunch = event("Lunch", "2026-09-25T11:00:00Z", "2026-09-25T12:00:00Z");
const breakfast = event(
  "Breakfast",
  "2026-09-25T06:00:00Z",
  "2026-09-25T06:30:00Z",
);
const holiday = event(
  "Holiday",
  "2026-09-25T00:00:00Z",
  "2026-09-26T00:00:00Z",
  true,
);
const yesterday = event(
  "Yesterday",
  "2026-09-24T00:00:00Z",
  "2026-09-25T00:00:00Z",
  true,
);

describe("pickNextUp", () => {
  it("picks the first timed event that has not ended, in local time", () => {
    expect(pickNextUp([lunch, holiday, breakfast, standup], NOW, TZ)).toEqual({
      title: "Standup",
      time: "09:30",
      when: "in 20 min",
      color: "#2f6fb5",
      joinUrl: null,
      leave: null,
    });
  });

  it("carries the meeting link for Join", () => {
    const call = {
      ...standup,
      description: "Join: https://meet.example.com/standup",
    };
    expect(pickNextUp([call], NOW, TZ)?.joinUrl).toBe(
      "https://meet.example.com/standup",
    );
    expect(pickNextUp([standup], NOW, TZ)?.joinUrl).toBeNull();
  });

  it("says Now for an event in progress and nothing an hour or more out", () => {
    const during = new Date("2026-09-25T07:35:00Z");
    expect(pickNextUp([standup], during, TZ)?.when).toBe("Now");
    expect(pickNextUp([lunch], NOW, TZ)?.when).toBeNull();
  });

  it("says when to leave with travel time, until the event starts", () => {
    const drive = {
      ...standup,
      travelMinutes: 25,
      travelStart: { title: "Home", address: "Storgatan 1" },
    };
    expect(pickNextUp([drive], NOW, TZ)?.leave).toBe("Leave 09:05");
    expect(headerNextUp([drive], TZ, NOW)?.leaveLine).toBe(
      "Leave 09:05 · 25 min travel from Home",
    );
    expect(pickNextUp([standup], NOW, TZ)?.leave).toBeNull();
    expect(headerNextUp([standup], TZ, NOW)?.leaveLine).toBeNull();
    const during = new Date("2026-09-25T07:35:00Z");
    expect(pickNextUp([drive], during, TZ)?.leave).toBeNull();
    expect(headerNextUp([drive], TZ, during)?.leaveLine).toBeNull();
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

// Under Next up the Mail panel lists the rest of today: what has not ended,
// all-day first, never the event already on the card (kurir-ios#329).
describe("laterToday", () => {
  it("is what is left of today after Next up", () => {
    expect(
      laterToday([lunch, breakfast, holiday, standup, yesterday], NOW, TZ).map(
        (row) => [row.time, row.title, row.isPast],
      ),
    ).toEqual([
      ["All day", "Holiday", false],
      ["13:00", "Lunch", false],
    ]);
  });

  it("keeps today's all-day events when nothing timed is left", () => {
    const evening = new Date("2026-09-25T20:00:00Z");
    expect(
      laterToday([lunch, holiday], evening, TZ).map((row) => row.title),
    ).toEqual(["Holiday"]);
  });

  it("gathers several all-day events on one line", () => {
    const nameDay = event(
      "Name day",
      "2026-09-25T00:00:00Z",
      "2026-09-26T00:00:00Z",
      true,
    );
    expect(
      laterToday([standup, lunch, holiday, nameDay], NOW, TZ).map((row) => [
        row.time,
        row.title,
      ]),
    ).toEqual([
      ["All day", "Holiday, Name day"],
      ["13:00", "Lunch"],
    ]);
  });
});
