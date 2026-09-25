import { describe, it, expect } from "vitest";
import { openSpans } from "@/components/calendar/agenda-model";
import {
  freetimeMinutes,
  openMinutesOnDay,
  weekColumnWidths,
} from "@/components/calendar/grid-model";
import { freeUntil, headerNextUp } from "@/components/calendar/header-model";
import { loadBar, openLabel } from "@/components/calendar/month-model";
import type { CalendarInstanceDTO } from "@/components/calendar/types";
import {
  DEFAULT_AVAILABILITY,
  type CalendarAvailability,
} from "@/lib/calendar/availability";
import {
  isoWeekNumber,
  weekDays,
  zonedWallToUtc,
  type CivilDate,
} from "@/lib/calendar/view-time";

const TZ = "Europe/Stockholm";
// A Friday.
const DAY: CivilDate = { year: 2026, month: 9, day: 25 };

function at(hour: number, minute = 0, day: CivilDate = DAY): Date {
  return zonedWallToUtc(TZ, { ...day, hour, minute });
}

function event(
  id: string,
  start: [number, number],
  end: [number, number],
  over: Partial<CalendarInstanceDTO> = {},
): CalendarInstanceDTO {
  return {
    eventId: id,
    title: id,
    startAt: at(...start).toISOString(),
    endAt: at(...end).toISOString(),
    isAllDay: false,
    isException: false,
    calendarId: "cal1",
    color: "#5a6474",
    calendarName: "Work",
    transparency: "busy",
    location: null,
    description: null,
    rrule: null,
    isReadOnly: false,
    ...over,
  };
}

/** Every day 07-21 except Friday, which gets `friday`. */
function withFriday(friday: {
  on: boolean;
  start: number;
  end: number;
}): CalendarAvailability {
  return {
    days: DEFAULT_AVAILABILITY.days.map((day, i) => (i === 4 ? friday : day)),
  };
}

describe("open time inside the available window", () => {
  it("counts free time only inside the day's own window", () => {
    // Friday 09:00-17:00; a lunch meeting 12-13 splits it in two.
    const availability = withFriday({ on: true, start: 540, end: 1020 });
    const instances = [event("lunch", [12, 0], [13, 0])];
    expect(freetimeMinutes(instances, DAY, TZ, availability)).toEqual([
      { startMin: 9 * 60, endMin: 12 * 60 },
      { startMin: 13 * 60, endMin: 17 * 60 },
    ]);
    expect(openMinutesOnDay(instances, DAY, TZ, availability)).toBe(7 * 60);
  });

  it("gives a day that is off no open time at all", () => {
    const availability = withFriday({ on: false, start: 420, end: 1260 });
    expect(freetimeMinutes([], DAY, TZ, availability)).toEqual([]);
    expect(openSpans([], DAY, TZ, availability)).toEqual([]);
    const bar = loadBar([], DAY, TZ, availability);
    expect(bar).toEqual({ off: true, openMinutes: 0, open: [], busy: [] });
    expect(openLabel(bar)).toBe("Not available");
  });
});

describe("loadBar", () => {
  it("splits the window into busy blocks, counted open spans and short gaps", () => {
    // 07-21 is 840 minutes. Busy 09:00-09:30, 10:30-11:00, 14-15 and
    // 20:30-22:00 (clipped to 21:00). The 09:30-10:30 hour is too short to
    // count and stays neutral.
    const instances = [
      event("a", [9, 0], [9, 30]),
      event("b", [10, 30], [11, 0], { color: "#8A3FA6" }),
      event("c", [14, 0], [15, 0]),
      event("late", [20, 30], [22, 0]),
    ];
    const bar = loadBar(instances, DAY, TZ, DEFAULT_AVAILABILITY);
    const len = 840;
    expect(bar.off).toBe(false);
    expect(bar.open).toEqual([
      { start: 0, width: 120 / len },
      { start: 240 / len, width: 180 / len },
      { start: 480 / len, width: 330 / len },
    ]);
    expect(bar.busy).toEqual([
      { start: 120 / len, width: 30 / len, color: "#5a6474" },
      { start: 210 / len, width: 30 / len, color: "#8a3fa6" },
      { start: 420 / len, width: 60 / len, color: "#5a6474" },
      { start: 810 / len, width: 30 / len, color: "#5a6474" },
    ]);
    expect(bar.openMinutes).toBe(630);
    expect(openLabel(bar)).toBe("10.5 h");
  });

  it("labels a day with no counted stretch as Full", () => {
    const bar = loadBar(
      [event("all", [7, 0], [21, 0])],
      DAY,
      TZ,
      DEFAULT_AVAILABILITY,
    );
    expect(openLabel(bar)).toBe("Full");
  });
});

describe("headerNextUp", () => {
  const next = event("next", [14, 0], [14, 30], {
    location: "Teams",
    description: "Join: https://teams.example.com/l/meetup-join/abc?x=1 now",
  });
  const instances = [
    event("ended", [9, 0], [9, 30]),
    event("later", [16, 0], [16, 30]),
    next,
    {
      ...event("allday", [0, 0], [0, 0]),
      isAllDay: true,
      startAt: "2026-09-25T00:00:00.000Z",
      endAt: "2026-09-26T00:00:00.000Z",
    },
  ];

  it("picks the sidebar's event - the first timed one not yet ended - with its join link", () => {
    const card = headerNextUp(instances, TZ, at(13, 51));
    expect(card?.instance.eventId).toBe("next");
    expect(card?.when).toBe("in 9 min");
    expect(card?.range).toBe("14:00–14:30");
    expect(card?.joinUrl).toBe(
      "https://teams.example.com/l/meetup-join/abc?x=1",
    );
  });

  it("keeps an ongoing meeting as Now, drops the minutes an hour out, and hides once today is over", () => {
    expect(headerNextUp(instances, TZ, at(14, 10))?.when).toBe("Now");
    const early = headerNextUp(instances, TZ, at(12, 0));
    expect(early?.instance.eventId).toBe("next");
    expect(early?.when).toBeNull();
    expect(headerNextUp(instances, TZ, at(16, 31))).toBeNull();
  });

  it("offers Join only when the event carries an http(s) link", () => {
    const card = headerNextUp(
      [event("room", [14, 0], [14, 30], { location: "Room 209" })],
      TZ,
      at(13, 0),
    );
    expect(card?.joinUrl).toBeNull();
  });
});

describe("header and week helpers", () => {
  it("says free until the next event only while now sits in a counted span", () => {
    const instances = [
      event("a", [9, 0], [10, 0]),
      event("b", [14, 0], [15, 0]),
    ];
    // 10-14 is open and ends at b.
    expect(freeUntil(instances, DAY, TZ, DEFAULT_AVAILABILITY, 13 * 60)).toBe(
      14 * 60,
    );
    // 15-21 runs to the end of the window: no event to be free until.
    expect(
      freeUntil(instances, DAY, TZ, DEFAULT_AVAILABILITY, 16 * 60),
    ).toBeNull();
    // Busy now.
    expect(
      freeUntil(instances, DAY, TZ, DEFAULT_AVAILABILITY, 9 * 60 + 30),
    ).toBeNull();
  });

  it("marks passed, current and longest open spans on today", () => {
    const instances = [
      event("a", [9, 0], [11, 0]),
      event("b", [14, 0], [14, 30]),
    ];
    const spans = openSpans(
      instances,
      DAY,
      TZ,
      DEFAULT_AVAILABILITY,
      13 * 60 + 51,
    );
    expect(
      spans.map((s) => [s.startMin, s.state, s.remaining, s.isLongest]),
    ).toEqual([
      [7 * 60, "passed", 0, false],
      [11 * 60, "now", 9, false],
      [14 * 60 + 30, "upcoming", 390, true],
    ]);
  });

  it("gives today 40% of the week and splits the rest, equal columns otherwise", () => {
    const days = weekDays(DAY);
    expect(weekColumnWidths(days, DAY)).toEqual([10, 10, 10, 10, 40, 10, 10]);
    const nextWeek = { ...DAY, month: 10, day: 5 };
    expect(weekColumnWidths(days, nextWeek)).toEqual(
      Array.from({ length: 7 }, () => 100 / 7),
    );
  });

  it("numbers weeks the ISO way", () => {
    expect(isoWeekNumber(DAY)).toBe(39);
    expect(isoWeekNumber({ year: 2026, month: 1, day: 1 })).toBe(1);
    expect(isoWeekNumber({ year: 2027, month: 1, day: 1 })).toBe(53);
  });
});
