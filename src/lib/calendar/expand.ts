import { RRule, RRuleSet } from "rrule";

export const INSTANCE_PAST_MONTHS = 2;
export const INSTANCE_FUTURE_MONTHS = 18;

export type Transparency = "busy" | "free";
export type EventStatus = "confirmed" | "tentative" | "cancelled";

export type EventMaster = {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  timezone: string | null;
  rrule: string | null;
  rdate: string | null;
  exdate: string | null;
  transparency: Transparency;
  status: EventStatus;
};

export type EventException = {
  masterEventId: string;
  recurrenceId: Date;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  isCancelled: boolean;
  title: string;
};

export type EventInstance = {
  eventId: string;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  isCancelled: boolean;
  isException: boolean;
  title: string;
};

export function instanceWindow(now: Date): { from: Date; to: Date } {
  const from = new Date(now.getTime());
  from.setUTCMonth(from.getUTCMonth() - INSTANCE_PAST_MONTHS);
  const to = new Date(now.getTime());
  to.setUTCMonth(to.getUTCMonth() + INSTANCE_FUTURE_MONTHS);
  return { from, to };
}

/** Parse comma-separated iCalendar UTC stamps like `20260818T080000Z`. */
function parseUtcStamps(value: string | null): Date[] {
  if (!value) return [];
  return value.split(",").flatMap((part) => {
    const s = part.trim();
    if (!s) return [];
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
    if (!m) return [];
    return [
      new Date(
        Date.UTC(
          Number(m[1]),
          Number(m[2]) - 1,
          Number(m[3]),
          Number(m[4]),
          Number(m[5]),
          Number(m[6]),
        ),
      ),
    ];
  });
}

function inWindow(start: Date, from: Date, to: Date): boolean {
  const t = start.getTime();
  return t >= from.getTime() && t < to.getTime();
}

function occurrenceStarts(
  master: EventMaster,
  from: Date,
  to: Date,
): Date[] {
  if (!master.rrule && !master.rdate) {
    return inWindow(master.startAt, from, to) ? [master.startAt] : [];
  }

  const set = new RRuleSet();
  if (master.rrule) {
    const options = RRule.parseString(master.rrule);
    options.dtstart = master.startAt;
    set.rrule(new RRule(options));
  }
  for (const d of parseUtcStamps(master.rdate)) {
    set.rdate(d);
  }
  for (const d of parseUtcStamps(master.exdate)) {
    set.exdate(d);
  }

  return set.between(from, to, true).filter((d) => inWindow(d, from, to));
}

export function expandEventWindow(
  master: EventMaster,
  exceptions: EventException[],
  from: Date,
  to: Date,
): EventInstance[] {
  if (master.status === "cancelled") return [];

  const durationMs = master.endAt.getTime() - master.startAt.getTime();
  const byRecurrenceId = new Map<number, EventException>();
  for (const ex of exceptions) {
    if (ex.masterEventId !== master.id) continue;
    byRecurrenceId.set(ex.recurrenceId.getTime(), ex);
  }

  const rows: EventInstance[] = [];

  for (const start of occurrenceStarts(master, from, to)) {
    const ex = byRecurrenceId.get(start.getTime());
    if (ex) {
      rows.push({
        eventId: master.id,
        startAt: ex.startAt,
        endAt: ex.endAt,
        isAllDay: ex.isAllDay,
        isCancelled: ex.isCancelled,
        isException: true,
        title: ex.title,
      });
      continue;
    }

    rows.push({
      eventId: master.id,
      startAt: start,
      endAt: new Date(start.getTime() + durationMs),
      isAllDay: master.isAllDay,
      isCancelled: false,
      isException: false,
      title: master.title,
    });
  }

  return rows;
}
