import { describe, it, expect } from "vitest";
import {
  expandEventWindow,
  instanceWindow,
  type EventMaster,
} from "@/lib/calendar/expand";

const timed: EventMaster = {
  id: "m1",
  title: "Standup",
  startAt: new Date("2026-08-17T08:00:00.000Z"),
  endAt: new Date("2026-08-17T08:15:00.000Z"),
  isAllDay: false,
  timezone: "UTC",
  rrule: "FREQ=DAILY;COUNT=5",
  rdate: null,
  exdate: null,
  transparency: "busy",
  status: "confirmed",
};

describe("instanceWindow", () => {
  it("is now minus 2 months through now plus 18 months", () => {
    const { from, to } = instanceWindow(new Date("2026-08-20T12:00:00.000Z"));
    expect(from.toISOString()).toBe("2026-06-20T12:00:00.000Z");
    expect(to.toISOString()).toBe("2028-02-20T12:00:00.000Z");
  });
});

describe("expandEventWindow", () => {
  it("returns the single interval when rrule is null", () => {
    const rows = expandEventWindow(
      { ...timed, rrule: null },
      [],
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-31T00:00:00.000Z"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.startAt.toISOString()).toBe("2026-08-17T08:00:00.000Z");
    expect(rows[0]?.isException).toBe(false);
  });

  it("expands a daily RRULE inside the window", () => {
    const rows = expandEventWindow(
      timed,
      [],
      new Date("2026-08-17T00:00:00.000Z"),
      new Date("2026-08-22T00:00:00.000Z"),
    );
    expect(rows).toHaveLength(5);
  });

  it("drops EXDATE occurrences", () => {
    const rows = expandEventWindow(
      { ...timed, exdate: "20260818T080000Z" },
      [],
      new Date("2026-08-17T00:00:00.000Z"),
      new Date("2026-08-22T00:00:00.000Z"),
    );
    expect(rows.map((r) => r.startAt.toISOString())).not.toContain(
      "2026-08-18T08:00:00.000Z",
    );
  });

  it("overlays an exception on the matching recurrenceId", () => {
    const rows = expandEventWindow(
      timed,
      [
        {
          masterEventId: "m1",
          recurrenceId: new Date("2026-08-18T08:00:00.000Z"),
          startAt: new Date("2026-08-18T09:00:00.000Z"),
          endAt: new Date("2026-08-18T09:15:00.000Z"),
          isAllDay: false,
          isCancelled: false,
          title: "Standup (moved)",
        },
      ],
      new Date("2026-08-17T00:00:00.000Z"),
      new Date("2026-08-22T00:00:00.000Z"),
    );
    const moved = rows.find(
      (r) => r.startAt.toISOString() === "2026-08-18T09:00:00.000Z",
    );
    expect(moved?.isException).toBe(true);
    expect(moved?.title).toBe("Standup (moved)");
  });

  it("does not zone-shift all-day civil dates", () => {
    const rows = expandEventWindow(
      {
        id: "m2",
        title: "Holiday",
        startAt: new Date("2026-08-20T00:00:00.000Z"),
        endAt: new Date("2026-08-21T00:00:00.000Z"),
        isAllDay: true,
        timezone: null,
        rrule: null,
        rdate: null,
        exdate: null,
        transparency: "busy",
        status: "confirmed",
      },
      [],
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-31T00:00:00.000Z"),
    );
    expect(rows[0]?.startAt.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(rows[0]?.endAt.toISOString()).toBe("2026-08-21T00:00:00.000Z");
    expect(rows[0]?.isAllDay).toBe(true);
  });

  /// Apple writes an annual birthday as FREQ=YEARLY;BYMONTHDAY=3 and renders
  /// it once a year. Read strictly, BYMONTHDAY expands inside the yearly
  /// period and nothing narrows it, so the rule means the 3rd of *every*
  /// month - which is how a grandfather ended up with twelve birthdays a
  /// year. A rule that really means monthly is written FREQ=MONTHLY.
  it("keeps a yearly BYMONTHDAY rule in the month DTSTART falls in", () => {
    const rows = expandEventWindow(
      {
        ...timed,
        isAllDay: true,
        startAt: new Date("2015-12-03T00:00:00.000Z"),
        endAt: new Date("2015-12-04T00:00:00.000Z"),
        timezone: null,
        rrule: "FREQ=YEARLY;BYMONTHDAY=3",
      },
      [],
      new Date("2026-06-01T00:00:00.000Z"),
      new Date("2027-06-01T00:00:00.000Z"),
    );

    expect(rows.map((row) => row.startAt.toISOString().slice(0, 10))).toEqual([
      "2026-12-03",
    ]);
  });

  /// The month is only borrowed when nothing else scopes the rule. An
  /// explicit BYMONTH is the author's own answer and must win.
  it("leaves an explicit BYMONTH alone", () => {
    const rows = expandEventWindow(
      {
        ...timed,
        isAllDay: true,
        startAt: new Date("2015-12-03T00:00:00.000Z"),
        endAt: new Date("2015-12-04T00:00:00.000Z"),
        timezone: null,
        rrule: "FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=3",
      },
      [],
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-12-31T00:00:00.000Z"),
    );

    expect(rows.map((row) => row.startAt.toISOString().slice(0, 10))).toEqual([
      "2026-06-03",
    ]);
  });

  /// BYWEEKNO and BYYEARDAY are genuinely year-scoped: their whole point is
  /// to pick a spot in the year rather than in a month, so pinning a month
  /// onto them would empty the rule out.
  it("does not pin a month onto a yearly BYYEARDAY rule", () => {
    const rows = expandEventWindow(
      {
        ...timed,
        isAllDay: true,
        startAt: new Date("2015-12-03T00:00:00.000Z"),
        endAt: new Date("2015-12-04T00:00:00.000Z"),
        timezone: null,
        rrule: "FREQ=YEARLY;BYYEARDAY=100",
      },
      [],
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-12-31T00:00:00.000Z"),
    );

    expect(rows.map((row) => row.startAt.toISOString().slice(0, 10))).toEqual([
      "2026-04-10",
    ]);
  });

  it("returns no rows when the master is cancelled", () => {
    const rows = expandEventWindow(
      { ...timed, status: "cancelled", rrule: null },
      [],
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-31T00:00:00.000Z"),
    );
    expect(rows).toEqual([]);
  });
});
