import { describe, it, expect } from "vitest";
import {
  eventRail,
  eventRepeatLine,
  eventTravelLines,
  eventWhenDate,
  eventWhenLine,
  noteSegments,
} from "@/components/calendar/event-view-model";
import type { CalendarInstanceDTO } from "@/components/calendar/types";

const TZ = "Europe/Stockholm";

function event(overrides: Partial<CalendarInstanceDTO>): CalendarInstanceDTO {
  return {
    eventId: "e1",
    title: "Calendar spec review",
    startAt: "2026-08-19T08:30:00.000Z",
    endAt: "2026-08-19T09:30:00.000Z",
    isAllDay: false,
    isException: false,
    calendarId: "cal1",
    color: "#059669",
    calendarName: "Work",
    transparency: "busy",
    location: "Rum Bergman",
    description: null,
    rrule: null,
    isReadOnly: false,
    ...overrides,
  };
}

describe("eventRail", () => {
  it("shows start, end and duration", () => {
    expect(
      eventRail(
        event({
          startAt: "2026-10-01T14:20:00.000Z",
          endAt: "2026-10-01T15:05:00.000Z",
        }),
        TZ,
      ),
    ).toEqual({ start: "16:20", end: "17:05", note: "45 min" });
  });

  it("ends at 24:00 when the event ends on midnight", () => {
    const rail = eventRail(
      event({
        startAt: "2026-08-19T20:00:00.000Z",
        endAt: "2026-08-19T22:00:00.000Z",
      }),
      TZ,
    );
    expect(rail.end).toBe("24:00");
    expect(rail.note).toBe("2 h");
  });

  it("has no clock times for an all-day event", () => {
    const allDay = event({
      isAllDay: true,
      startAt: "2026-08-19T00:00:00.000Z",
      endAt: "2026-08-21T00:00:00.000Z",
    });
    expect(eventRail(allDay, TZ)).toEqual({
      start: "All-day",
      end: null,
      note: null,
    });
    expect(eventWhenDate(allDay, TZ)).toBe(
      "Wednesday 19 August - Thursday 20 August",
    );
  });
});

describe("eventWhenDate and eventWhenLine", () => {
  it("is one date for a one-day event", () => {
    expect(eventWhenDate(event({}), TZ)).toBe("Wednesday 19 August");
    expect(eventWhenLine(event({}), TZ)).toBe(
      "Wednesday 19 August · 10:30 - 11:30",
    );
  });

  it("names both days for an event across midnight", () => {
    expect(
      eventWhenLine(
        event({
          startAt: "2026-08-19T20:00:00.000Z",
          endAt: "2026-08-20T04:00:00.000Z",
        }),
        TZ,
      ),
    ).toBe("Wednesday 19 August 22:00 - Thursday 20 August 06:00");
  });
});

describe("eventRepeatLine", () => {
  it("matches the apps' wording per preset", () => {
    expect(eventRepeatLine(event({}), TZ)).toBeNull();
    expect(eventRepeatLine(event({ rrule: "FREQ=DAILY" }), TZ)).toBe(
      "Every day",
    );
    expect(eventRepeatLine(event({ rrule: "FREQ=WEEKLY" }), TZ)).toBe(
      "Weekly on Wednesdays",
    );
    expect(
      eventRepeatLine(event({ rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" }), TZ),
    ).toBe("Every weekday");
    expect(eventRepeatLine(event({ rrule: "FREQ=MONTHLY" }), TZ)).toBe(
      "Monthly",
    );
    expect(
      eventRepeatLine(event({ rrule: "FREQ=WEEKLY;INTERVAL=2" }), TZ),
    ).toBe("Repeats");
  });
});

describe("eventTravelLines", () => {
  it("says how long the travel is and where it starts", () => {
    expect(eventTravelLines(event({ travelMinutes: 30 }))).toEqual([
      "30 min travel",
    ]);
    expect(
      eventTravelLines(
        event({ travelMinutes: 90, travelStart: { title: "Home", address: null } }),
      ),
    ).toEqual(["1.5 h travel from Home"]);
    expect(
      eventTravelLines(
        event({
          travelMinutes: 25,
          travelStart: { title: null, address: "Storgatan 1\n111 22 Stockholm" },
        }),
      ),
    ).toEqual(["25 min travel from Storgatan 1"]);
  });

  it("puts travel after on its own line, alone when there is no travel before", () => {
    expect(
      eventTravelLines(
        event({
          travelMinutes: 25,
          travelStart: { title: "Home", address: null },
          travelAfterMinutes: 30,
        }),
      ),
    ).toEqual(["25 min travel from Home", "30 min travel after"]);
    expect(eventTravelLines(event({ travelAfterMinutes: 45 }))).toEqual([
      "45 min travel after",
    ]);
  });

  it("is empty without travel time, and for an all-day event", () => {
    expect(eventTravelLines(event({}))).toEqual([]);
    expect(
      eventTravelLines(
        event({ isAllDay: true, travelMinutes: 30, travelAfterMinutes: 30 }),
      ),
    ).toEqual([]);
  });
});

describe("noteSegments", () => {
  it("links web and email addresses", () => {
    const links = noteSegments(
      "Join https://meet.example.com/abc or mail anna@example.com.",
    )
      .filter((segment) => segment.href)
      .map((segment) => segment.href);
    expect(links).toEqual([
      "https://meet.example.com/abc",
      "mailto:anna@example.com",
    ]);
  });

  it("keeps text without addresses as one plain segment", () => {
    expect(noteSegments("Kod: 1796. Handduk i väskan.")).toEqual([
      { text: "Kod: 1796. Handduk i väskan." },
    ]);
  });

  it("gives www addresses a scheme and leaves the punctuation outside", () => {
    expect(noteSegments("See www.example.com/x.")).toEqual([
      { text: "See " },
      { text: "www.example.com/x", href: "https://www.example.com/x" },
      { text: "." },
    ]);
  });
});
