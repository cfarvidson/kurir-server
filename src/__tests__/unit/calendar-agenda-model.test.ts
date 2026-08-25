import { describe, it, expect } from "vitest";
import {
  agendaRows,
  ALL_DAY_START_MIN,
  nowLineIndex,
} from "@/components/calendar/agenda-model";
import type { CalendarInstanceDTO } from "@/components/calendar/types";
import { zonedWallToUtc, type CivilDate } from "@/lib/calendar/view-time";

const TZ = "Europe/Stockholm";
const DAY: CivilDate = { year: 2026, month: 8, day: 19 };

function local(hour: number, minute = 0): string {
  return zonedWallToUtc(TZ, { ...DAY, hour, minute }).toISOString();
}

function base(over: Partial<CalendarInstanceDTO>): CalendarInstanceDTO {
  return {
    eventId: "e1",
    title: "Event",
    startAt: local(9),
    endAt: local(10),
    isAllDay: false,
    isException: false,
    calendarId: "cal1",
    color: "#059669",
    calendarName: "Work",
    transparency: "busy",
    location: null,
    description: null,
    rrule: null,
    isReadOnly: false,
    ...over,
  };
}

function timed(
  id: string,
  startHour: number,
  endHour: number,
  minute = 0,
): CalendarInstanceDTO {
  return base({
    eventId: id,
    title: id,
    startAt: local(startHour, minute),
    endAt: local(endHour, minute),
  });
}

function allDay(id: string, title = id): CalendarInstanceDTO {
  return base({
    eventId: id,
    title,
    startAt: "2026-08-19T00:00:00.000Z",
    endAt: "2026-08-20T00:00:00.000Z",
    isAllDay: true,
    calendarName: "Personal",
    color: "#7c3aed",
  });
}

function kinds(rows: ReturnType<typeof agendaRows>): string[] {
  return rows.map((row) =>
    row.kind === "event" ? row.instance.title : row.kind,
  );
}

describe("agendaRows", () => {
  it("puts all-day rows first, before everything with a clock time", () => {
    const rows = agendaRows([timed("standup", 9, 10), allDay("Vacation")], DAY, TZ);
    const first = rows[0];
    expect(first.kind).toBe("event");
    if (first.kind === "event") expect(first.instance.title).toBe("Vacation");
    expect(first.startMin).toBe(ALL_DAY_START_MIN);
    expect(first.timeLabel).toBeNull();
    expect(first.durationLabel).toBe("All-day");
  });

  it("interleaves free spans with events by start time", () => {
    // 09-10 busy, then free until 14, then 14-15 busy. 07-09 is also a
    // two-hour hole and comes first.
    const rows = agendaRows([timed("a", 9, 10), timed("b", 14, 15)], DAY, TZ);
    expect(kinds(rows)).toEqual(["free", "a", "free", "b", "free"]);
  });

  it("flags the day's longest free span", () => {
    // 07-09 (2 h), 10-14 (4 h), 15-21 (6 h).
    const rows = agendaRows([timed("a", 9, 10), timed("b", 14, 15)], DAY, TZ);
    const flags = rows.flatMap((row) =>
      row.kind === "free" ? [row.isLongest] : [],
    );
    expect(flags).toEqual([false, false, true]);
  });

  it("gives timed rows time and duration labels", () => {
    // 09:00-09:00 is clipped to at least 15 minutes by placement.
    const rows = agendaRows([timed("standup", 9, 9)], DAY, TZ);
    const row = rows.find((r) => r.kind === "event");
    expect(row?.timeLabel).toBe("09:00");
    expect(row?.durationLabel).toBe("15 min");
  });

  it("renders an empty day as one free row, not an empty list", () => {
    const rows = agendaRows([], DAY, TZ);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind).toBe("free");
    if (row.kind === "free") {
      expect(row.minutes).toBe((21 - 7) * 60);
      expect(row.isLongest).toBe(true);
    }
  });

  it("keeps row ids stable and unique - they are render keys", () => {
    const rows = agendaRows(
      [timed("a", 9, 10), timed("b", 14, 15), allDay("V")],
      DAY,
      TZ,
    );
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("keeps all-day rows in title order, not id order", () => {
    const rows = agendaRows(
      [allDay("id-z", "aaa-title"), allDay("id-a", "zzz-title")],
      DAY,
      TZ,
    );
    const titles = rows.flatMap((row) =>
      row.kind === "event" ? [row.instance.title] : [],
    );
    expect(titles.slice(0, 2)).toEqual(["aaa-title", "zzz-title"]);
  });

  it("flags exactly one of two equally long spans, and it is the first", () => {
    // a occupies 9-11, b occupies 13-21 (to the end of the day). Exactly
    // two 2 h holes remain: 07-09 and 11-13.
    const rows = agendaRows([timed("a", 9, 11), timed("b", 13, 21)], DAY, TZ);
    const flags = rows.flatMap((row) =>
      row.kind === "free" ? [row.isLongest] : [],
    );
    expect(flags.filter(Boolean)).toHaveLength(1);
    expect(flags.indexOf(true)).toBe(0);
  });

  it("turns short holes into bookable gap rows", () => {
    const rows = agendaRows(
      [timed("a", 9, 11), timed("b", 12, 14), timed("c", 15, 17)],
      DAY,
      TZ,
    );
    const gaps = rows.flatMap((row) =>
      row.kind === "gap" ? [{ startMin: row.startMin, endMin: row.endMin }] : [],
    );
    expect(gaps).toEqual([
      { startMin: 11 * 60, endMin: 12 * 60 },
      { startMin: 14 * 60, endMin: 15 * 60 },
    ]);
  });

  it("offers a hole past the free-time threshold as free time, never as a gap too", () => {
    const rows = agendaRows([timed("a", 9, 10), timed("b", 15, 16)], DAY, TZ);
    expect(rows.filter((row) => row.kind === "gap")).toHaveLength(0);
    expect(rows.filter((row) => row.kind === "free")).toHaveLength(3);
  });

  it("does not offer a hole too short to book", () => {
    // Ten minutes between two meetings is the walk between them.
    const rows = agendaRows(
      [timed("a", 9, 10), timed("b", 10, 11, 10)],
      DAY,
      TZ,
    );
    expect(rows.some((row) => row.kind === "gap")).toBe(false);
  });

  it("sorts gaps into the timeline at their own time", () => {
    const rows = agendaRows(
      [timed("a", 9, 11), timed("b", 12, 14), timed("c", 15, 17)],
      DAY,
      TZ,
    );
    const starts = rows.map((row) => row.startMin);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

describe("agendaRows with now", () => {
  it("clips a free span straddling now to its remaining minutes", () => {
    // Free 07-09, a 09-10, free 10-21. Now 12:00 is inside the second span.
    const now = 12 * 60;
    const rows = agendaRows([timed("a", 9, 10)], DAY, TZ, now);
    expect(kinds(rows)).toEqual(["free", "a", "free"]);
    const clipped = rows[2];
    if (clipped.kind !== "free") throw new Error("expected free row");
    // The claim starts at now, so creating an event from it does too.
    expect(clipped.startMin).toBe(now);
    expect(clipped.minutes).toBe(21 * 60 - now);
    expect(clipped.timeLabel).toBe("12:00");
    // The past span keeps its shape - history is not rewritten.
    const past = rows[0];
    if (past.kind !== "free") throw new Error("expected free row");
    expect(past.startMin).toBe(7 * 60);
    expect(past.minutes).toBe(120);
  });

  it("chooses the longest stretch by remaining minutes, not original length", () => {
    // Holes: 08-13 (5 h) and 14-16 (2 h). At 12:00 only an hour remains of
    // the big one, so the small one is the day's longest stretch.
    const rows = agendaRows(
      [timed("a", 7, 8), timed("b", 13, 14), timed("c", 16, 21)],
      DAY,
      TZ,
      12 * 60,
    );
    const spans = rows.flatMap((row) =>
      row.kind === "free" ? [{ minutes: row.minutes, isLongest: row.isLongest }] : [],
    );
    expect(spans).toEqual([
      { minutes: 60, isLongest: false },
      { minutes: 120, isLongest: true },
    ]);
  });

  it("flags no stretch when the whole day is behind now", () => {
    const rows = agendaRows([timed("a", 9, 10)], DAY, TZ, 22 * 60);
    expect(rows.some((row) => row.kind === "free" && row.isLongest)).toBe(false);
  });

  it("clips a short gap straddling now", () => {
    // Gaps 11-12 and 14-15. Now 11:20 leaves 40 bookable minutes.
    const rows = agendaRows(
      [timed("a", 9, 11), timed("b", 12, 14), timed("c", 15, 17)],
      DAY,
      TZ,
      11 * 60 + 20,
    );
    const gaps = rows.flatMap((row) => (row.kind === "gap" ? [row] : []));
    expect(gaps.map((g) => g.startMin)).toEqual([11 * 60 + 20, 14 * 60]);
    expect(gaps[0].minutes).toBe(40);
    expect(gaps[0].timeLabel).toBe("11:20");
    expect(gaps[0].durationLabel).toBe("40 min");
  });

  it("marks the ongoing event as current, including one starting exactly now", () => {
    const during = agendaRows([timed("a", 9, 10)], DAY, TZ, 9 * 60 + 30);
    const atStart = agendaRows([timed("a", 9, 10)], DAY, TZ, 9 * 60);
    for (const rows of [during, atStart]) {
      const event = rows.find((row) => row.kind === "event");
      expect(event?.kind === "event" && event.isNow).toBe(true);
    }
  });

  it("never marks all-day rows or events on other days as current", () => {
    const rows = agendaRows([allDay("V"), timed("a", 9, 10)], DAY, TZ, 12 * 60);
    const allDayRow = rows[0];
    expect(allDayRow.kind === "event" && allDayRow.isNow).toBe(false);
    const other = agendaRows([timed("a", 9, 10)], DAY, TZ, null);
    expect(other.some((row) => row.kind === "event" && row.isNow)).toBe(false);
  });

  it("leaves a day that is not today untouched", () => {
    const instances = [timed("a", 9, 10), timed("b", 14, 15)];
    expect(agendaRows(instances, DAY, TZ, null)).toEqual(
      agendaRows(instances, DAY, TZ),
    );
  });
});

describe("nowLineIndex", () => {
  it("puts the line at the now boundary before the first row at or after now", () => {
    const now = 12 * 60;
    const rows = agendaRows([timed("a", 9, 10), timed("b", 14, 15)], DAY, TZ, now);
    // Rows: free 07:00, a 09:00, free 12:00 (clipped), b 14:00, free 15:00.
    expect(nowLineIndex(rows, now)).toBe(2);
  });

  it("suppresses the line while an event is ongoing", () => {
    const now = 9 * 60 + 30;
    const rows = agendaRows([timed("a", 9, 10)], DAY, TZ, now);
    expect(nowLineIndex(rows, now)).toBeNull();
  });

  it("sits at the boundary the moment an event ends, not under it earlier", () => {
    const now = 10 * 60;
    const rows = agendaRows([timed("a", 9, 10)], DAY, TZ, now);
    // Rows: free 07:00, a 09:00, free 10:00. The line lands exactly on the
    // 10:00 boundary, before the free row that starts there.
    expect(nowLineIndex(rows, now)).toBe(2);
  });

  it("renders before the first row when now precedes the day, after all-day rows", () => {
    const now = 6 * 60;
    const rows = agendaRows([allDay("V"), timed("a", 9, 10)], DAY, TZ, now);
    expect(nowLineIndex(rows, now)).toBe(1);
  });

  it("renders after the last row when the day is over", () => {
    const now = 22 * 60;
    const rows = agendaRows([timed("a", 9, 10)], DAY, TZ, now);
    expect(nowLineIndex(rows, now)).toBe(rows.length);
  });
});
