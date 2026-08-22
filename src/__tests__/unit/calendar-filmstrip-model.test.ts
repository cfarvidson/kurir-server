import { describe, it, expect } from "vitest";
import {
  buildDaySpans,
  buildFilmstrip,
  DAY_END_MIN,
  DAY_START_MIN,
  MIN_SLAT_PX,
  NIGHT_RUN_PX,
  stripDayOffsets,
  stripIndexAtOffset,
  stripOffsetForIndex,
  xForMinute,
} from "@/components/calendar/filmstrip-model";
import type { CalendarInstanceDTO } from "@/components/calendar/types";

const TZ = "Europe/Stockholm";
const DAYTIME_PX = DAY_END_MIN - DAY_START_MIN; // 840 at 1 px/min
const EMPTY_DAY_PX = NIGHT_RUN_PX + DAYTIME_PX + NIGHT_RUN_PX; // 912

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

describe("buildDaySpans", () => {
  it("collapses both empty nights around a proportional daytime", () => {
    const spans = buildDaySpans([]);
    expect(spans).toHaveLength(3);
    expect(spans[0]).toMatchObject({
      fromMin: 0,
      toMin: DAY_START_MIN,
      fromPx: 0,
      toPx: NIGHT_RUN_PX,
      collapsed: true,
    });
    expect(spans[1]).toMatchObject({
      fromMin: DAY_START_MIN,
      toMin: DAY_END_MIN,
      collapsed: false,
    });
    expect(spans[2].toPx).toBe(EMPTY_DAY_PX);
  });

  it("keeps night event clusters proportional", () => {
    // 23:00-24:00 day-clipped event
    const spans = buildDaySpans([{ startMin: 23 * 60, endMin: 24 * 60 }]);
    const trail = spans.filter((s) => s.fromMin >= DAY_END_MIN);
    expect(trail.map((s) => [s.fromMin, s.toMin, s.collapsed])).toEqual([
      [DAY_END_MIN, 23 * 60, true],
      [23 * 60, 24 * 60, false],
    ]);
    // collapsed run 36px + active hour 60px
    expect(spans[spans.length - 1].toPx).toBe(
      NIGHT_RUN_PX + DAYTIME_PX + NIGHT_RUN_PX + 60,
    );
  });

  it("leaves short empty night runs proportional", () => {
    // 21:30-22:30 event: the 30 min before it is too short to collapse
    const spans = buildDaySpans([{ startMin: 21 * 60 + 30, endMin: 22 * 60 + 30 }]);
    const trail = spans.filter((s) => s.fromMin >= DAY_END_MIN);
    expect(trail.map((s) => [s.toMin - s.fromMin, s.collapsed])).toEqual([
      [30, false],
      [60, false],
      [90, true],
    ]);
  });

  it("merges overlapping night events into one cluster", () => {
    const spans = buildDaySpans([
      { startMin: 22 * 60, endMin: 23 * 60 },
      { startMin: 22 * 60 + 30, endMin: 23 * 60 + 30 },
    ]);
    // One span covers the merged cluster; no boundary splits it at 22:30.
    const cluster = spans.find((s) => s.fromMin === 22 * 60);
    expect(cluster?.toMin).toBe(23 * 60 + 30);
    expect(cluster?.collapsed).toBe(false);
  });
});

describe("xForMinute", () => {
  const spans = buildDaySpans([]);

  it("maps daytime proportionally after the collapsed lead night", () => {
    expect(xForMinute(spans, DAY_START_MIN)).toBe(NIGHT_RUN_PX);
    expect(xForMinute(spans, 9 * 60)).toBe(NIGHT_RUN_PX + 120);
  });

  it("interpolates inside collapsed runs and clamps at the edges", () => {
    expect(xForMinute(spans, 0)).toBe(0);
    expect(xForMinute(spans, -50)).toBe(0);
    expect(xForMinute(spans, 24 * 60)).toBe(EMPTY_DAY_PX);
    expect(xForMinute(spans, 99999)).toBe(EMPTY_DAY_PX);
    // Midpoint of the lead night maps to the middle of its collapsed band.
    expect(xForMinute(spans, DAY_START_MIN / 2)).toBeCloseTo(NIGHT_RUN_PX / 2);
  });
});

describe("buildFilmstrip", () => {
  it("positions slats proportionally with true duration labels", () => {
    const days = buildFilmstrip([inst({})], [FRI], TZ, NOON);
    expect(days[0].widthPx).toBe(EMPTY_DAY_PX);
    expect(days[0].slats).toHaveLength(1);
    const slat = days[0].slats[0];
    // 09:00 = minute 540 -> 36 + (540 - 420)
    expect(slat.xPx).toBe(NIGHT_RUN_PX + 120);
    expect(slat.widthPx).toBe(60);
    expect(slat.startLabel).toBe("09:00");
    expect(slat.durationLabel).toBe("1 h");
    expect(slat.lanes).toBe(1);
  });

  it("clamps very short events to a readable slat width", () => {
    const days = buildFilmstrip(
      [inst({ endAt: "2026-08-21T07:15:00.000Z" })],
      [FRI],
      TZ,
      NOON,
    );
    expect(days[0].slats[0].widthPx).toBe(MIN_SLAT_PX);
  });

  it("splits overlapping events into lanes", () => {
    const days = buildFilmstrip(
      [
        inst({ eventId: "a" }),
        inst({
          eventId: "b",
          startAt: "2026-08-21T07:30:00.000Z",
          endAt: "2026-08-21T08:30:00.000Z",
        }),
      ],
      [FRI],
      TZ,
      NOON,
    );
    const lanes = days[0].slats.map((s) => [s.lane, s.lanes]);
    expect(lanes).toContainEqual([0, 2]);
    expect(lanes).toContainEqual([1, 2]);
  });

  it("exposes freetime zones with pixel geometry", () => {
    const days = buildFilmstrip([], [{ ...FRI, day: 22 }], TZ, NOON);
    expect(days[0].slats).toHaveLength(0);
    expect(days[0].freetime).toHaveLength(1);
    expect(days[0].freetime[0]).toMatchObject({
      startMin: DAY_START_MIN,
      endMin: DAY_END_MIN,
      minutes: DAYTIME_PX,
      xPx: NIGHT_RUN_PX,
      widthPx: DAYTIME_PX,
    });
  });

  it("marks today with a now position and past days without one", () => {
    const days = buildFilmstrip([], [{ ...FRI, day: 20 }, FRI], TZ, NOON);
    expect(days[0].isPast).toBe(true);
    expect(days[0].nowXPx).toBeNull();
    expect(days[1].isToday).toBe(true);
    // 12:00 = minute 720 -> 36 + (720 - 420)
    expect(days[1].nowXPx).toBe(NIGHT_RUN_PX + 300);
    expect(days[1].nowTimeLabel).toBe("12:00");
  });

  it("separates all-day events from the slats", () => {
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
    expect(days[0].slats).toHaveLength(0);
    expect(days[0].widthPx).toBe(EMPTY_DAY_PX);
  });

  it("renders a midnight-crosser contiguously across the boundary", () => {
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
    const fri = days[0].slats[0];
    const sat = days[1].slats[0];
    expect(fri.startLabel).toBe("23:00");
    expect(fri.durationLabel).toBe("2 h");
    expect(sat.durationLabel).toBe("2 h");
    // Friday's part runs to the day's right edge; Saturday's starts at 0.
    expect(fri.xPx + fri.widthPx).toBe(days[0].widthPx);
    expect(sat.xPx).toBe(0);
    expect(sat.widthPx).toBe(60);
  });

  it("puts hour ticks only in the daytime band", () => {
    const days = buildFilmstrip([], [FRI], TZ, NOON);
    expect(days[0].hourTicks[0]).toEqual({ hour: 7, xPx: NIGHT_RUN_PX });
    expect(days[0].hourTicks[days[0].hourTicks.length - 1].hour).toBe(20);
  });

  it("describes both night bands", () => {
    const days = buildFilmstrip([], [FRI], TZ, NOON);
    expect(days[0].nights[0]).toEqual({
      xPx: 0,
      widthPx: NIGHT_RUN_PX,
      edge: "lead",
    });
    expect(days[0].nights[1]).toEqual({
      xPx: NIGHT_RUN_PX + DAYTIME_PX,
      widthPx: NIGHT_RUN_PX,
      edge: "trail",
    });
  });

  it("handles the DST fall-back day without negative geometry", () => {
    // Europe/Stockholm 2026-10-25 is 25 h long
    const dst = { year: 2026, month: 10, day: 25 };
    const days = buildFilmstrip([], [dst], TZ, NOON);
    expect(days[0].widthPx).toBe(EMPTY_DAY_PX);
    for (const zone of days[0].freetime) {
      expect(zone.widthPx).toBeGreaterThan(0);
    }
  });
});

describe("strip scroll math", () => {
  const widths = [912, 972, 912];
  const offsets = stripDayOffsets(widths);

  it("prefix-sums day widths into offsets", () => {
    expect(offsets).toEqual([0, 912, 1884]);
  });

  it("round-trips index <-> offset", () => {
    expect(stripOffsetForIndex(0, 48, offsets)).toBe(48);
    expect(stripOffsetForIndex(2, 48, offsets)).toBe(48 + 1884);
  });

  it("finds the day containing a probe point", () => {
    expect(stripIndexAtOffset(48 + 100, 48, offsets)).toBe(0);
    expect(stripIndexAtOffset(48 + 912, 48, offsets)).toBe(1);
    expect(stripIndexAtOffset(48 + 1000, 48, offsets)).toBe(1);
    expect(stripIndexAtOffset(48 + 2000, 48, offsets)).toBe(2);
  });

  it("clamps to the rendered days", () => {
    expect(stripIndexAtOffset(-500, 48, offsets)).toBe(0);
    expect(stripIndexAtOffset(1e9, 48, offsets)).toBe(2);
    expect(stripIndexAtOffset(100, 48, [])).toBe(0);
  });
});
