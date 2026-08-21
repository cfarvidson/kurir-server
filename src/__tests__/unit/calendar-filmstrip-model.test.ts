import { describe, it, expect } from "vitest";
import {
  buildFilmstrip,
  entryHeightPx,
} from "@/components/calendar/filmstrip-model";
import type { CalendarInstanceDTO } from "@/components/calendar/types";

const TZ = "Europe/Stockholm";

function inst(over: Partial<CalendarInstanceDTO>): CalendarInstanceDTO {
  return {
    eventId: "e1",
    title: "Event",
    startAt: "2026-08-21T07:00:00.000Z", // 09:00 Stockholm (CEST)
    endAt: "2026-08-21T08:00:00.000Z",
    isAllDay: false,
    isException: false,
    calendarId: "c1",
    color: "#b45309",
    calendarName: "Personal",
    transparency: "busy",
    location: null,
    description: null,
    rrule: null,
    isReadOnly: false,
    ...over,
  };
}

const FRI: { year: number; month: number; day: number } = {
  year: 2026,
  month: 8,
  day: 21,
};
const NOON = new Date("2026-08-21T10:00:00.000Z"); // 12:00 Stockholm

describe("entryHeightPx", () => {
  it("scales with duration and clamps", () => {
    expect(entryHeightPx(60)).toBe(54);
    expect(entryHeightPx(180)).toBe(114);
    expect(entryHeightPx(15)).toBe(40);
    expect(entryHeightPx(600)).toBe(140);
  });
});

describe("buildFilmstrip", () => {
  it("orders events and freetime by start, seam last", () => {
    const days = buildFilmstrip(
      [
        inst({}), // 09:00-10:00
        inst({
          eventId: "e2",
          title: "Deep work",
          startAt: "2026-08-21T11:00:00.000Z", // 13:00
          endAt: "2026-08-21T12:00:00.000Z",
        }),
      ],
      [FRI],
      TZ,
      NOON,
    );
    const kinds = days[0].items.map((i) => i.kind);
    // freetime 07-09 (120 min), event 09-10, freetime 10-13, event 13-14,
    // freetime 14-21 (420 min), seam
    expect(kinds).toEqual([
      "freetime",
      "event",
      "freetime",
      "event",
      "freetime",
      "seam",
    ]);
    const first = days[0].items[1];
    expect(first.kind).toBe("event");
    if (first.kind === "event") {
      expect(first.startLabel).toBe("09:00");
      expect(first.durationLabel).toBe("1 h");
    }
  });

  it("orders same-start events by endMin, shorter first", () => {
    const days = buildFilmstrip(
      [
        inst({
          eventId: "long",
          title: "Long meeting",
          startAt: "2026-08-21T07:00:00.000Z", // 09:00
          endAt: "2026-08-21T09:00:00.000Z", // 11:00
        }),
        inst({
          eventId: "short",
          title: "Quick sync",
          startAt: "2026-08-21T07:00:00.000Z", // 09:00
          endAt: "2026-08-21T07:30:00.000Z", // 09:30
        }),
      ],
      [FRI],
      TZ,
      NOON,
    );
    const events = days[0].items.filter((i) => i.kind === "event");
    expect(events.map((e) => (e.kind === "event" ? e.instance.eventId : ""))).toEqual([
      "short",
      "long",
    ]);
  });

  it("places the now marker inside the containing item", () => {
    const days = buildFilmstrip([inst({})], [FRI], TZ, NOON);
    // The only event is 09:00-10:00, so 12:00 falls inside the 10:00-21:00
    // freetime gap that follows it.
    expect(days[0].isToday).toBe(true);
    expect(days[0].now).not.toBeNull();
    expect(days[0].nowTimeLabel).toBe("12:00");
    if (days[0].now?.kind === "in-item") {
      const item = days[0].items[days[0].now.index];
      expect(item.kind).toBe("freetime");
      expect(days[0].now.fraction).toBeGreaterThan(0);
      expect(days[0].now.fraction).toBeLessThan(1);
    } else {
      throw new Error("expected in-item now marker");
    }
  });

  it("marks past days and gives them no now marker", () => {
    const days = buildFilmstrip([], [{ ...FRI, day: 20 }, FRI], TZ, NOON);
    expect(days[0].isPast).toBe(true);
    expect(days[0].now).toBeNull();
    expect(days[1].isPast).toBe(false);
  });

  it("separates all-day events from the flow", () => {
    const days = buildFilmstrip(
      [
        inst({
          eventId: "hol",
          isAllDay: true,
          startAt: "2026-08-21T00:00:00.000Z",
          endAt: "2026-08-22T00:00:00.000Z",
        }),
      ],
      [FRI],
      TZ,
      NOON,
    );
    expect(days[0].allDay).toHaveLength(1);
    // whole visible day is one freetime span + seam
    expect(days[0].items.map((i) => i.kind)).toEqual(["freetime", "seam"]);
  });

  it("an empty day is one freetime span plus a seam", () => {
    const days = buildFilmstrip([], [{ ...FRI, day: 22 }], TZ, NOON);
    expect(days[0].items.map((i) => i.kind)).toEqual(["freetime", "seam"]);
  });

  it("labels a midnight-crossing event with its true span on both days", () => {
    const days = buildFilmstrip(
      [
        inst({
          eventId: "night",
          title: "Night shift",
          startAt: "2026-08-21T21:00:00.000Z", // 23:00 Fri
          endAt: "2026-08-21T23:00:00.000Z", // 01:00 Sat
        }),
      ],
      [FRI, { ...FRI, day: 22 }],
      TZ,
      NOON,
    );
    const fri = days[0].items.find((i) => i.kind === "event");
    const sat = days[1].items.find((i) => i.kind === "event");
    if (fri?.kind !== "event" || sat?.kind !== "event") {
      throw new Error("expected the event on both days");
    }
    expect([fri.startMin, fri.endMin]).toEqual([23 * 60, 24 * 60]);
    expect([sat.startMin, sat.endMin]).toEqual([0, 60]);
    expect(fri.durationLabel).toBe("2 h");
    expect(sat.durationLabel).toBe("2 h");
  });

  it("keeps the now marker on an empty today", () => {
    const days = buildFilmstrip([], [FRI], TZ, NOON);
    expect(days[0].isToday).toBe(true);
    expect(days[0].now).not.toBeNull();
    expect(days[0].nowTimeLabel).toBe("12:00");
  });

  it("handles the DST fall-back day without negative spans", () => {
    // Europe/Stockholm 2026-10-25 is 25 h long
    const dst = { year: 2026, month: 10, day: 25 };
    const days = buildFilmstrip([], [dst], TZ, NOON);
    for (const item of days[0].items) {
      if (item.kind !== "seam") {
        expect(item.endMin).toBeGreaterThan(item.startMin);
        expect(item.heightPx).toBeGreaterThanOrEqual(40);
      }
    }
  });
});
