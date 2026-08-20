import { db } from "@/lib/db";
import {
  expandEventWindow,
  instanceWindow,
  type EventException,
  type EventInstance,
  type EventMaster,
  type EventStatus,
  type Transparency,
} from "@/lib/calendar/expand";
import { needsOnTheFlyExpand, overlaps } from "@/lib/calendar/range";

const FALLBACK_COLOR = "#737373";

export type VisibleInstance = EventInstance & {
  calendarId: string;
  color: string;
  calendarName: string;
};

type CalendarMeta = {
  id: string;
  name: string;
  color: string | null;
  isVisible: boolean;
};

type MasterRow = {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  timezone: string | null;
  rrule: string | null;
  rdate: string | null;
  exdate: string | null;
  transparency: string;
  status: string;
  calendarId: string;
  calendar: CalendarMeta;
  exceptions: Array<{
    recurrenceId: Date | null;
    startAt: Date;
    endAt: Date;
    isAllDay: boolean;
    status: string;
    title: string;
  }>;
};

type InstanceRow = {
  eventId: string;
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  isCancelled: boolean;
  isException: boolean;
  calendarId: string;
  event: { title: string };
  calendar: CalendarMeta;
};

function calendarColor(color: string | null | undefined): string {
  const trimmed = color?.trim();
  return trimmed ? trimmed : FALLBACK_COLOR;
}

function toEventMaster(row: MasterRow): EventMaster {
  const transparency: Transparency =
    row.transparency === "free" ? "free" : "busy";
  const status: EventStatus =
    row.status === "cancelled" || row.status === "tentative"
      ? row.status
      : "confirmed";
  return {
    id: row.id,
    title: row.title,
    startAt: row.startAt,
    endAt: row.endAt,
    isAllDay: row.isAllDay,
    timezone: row.timezone,
    rrule: row.rrule,
    rdate: row.rdate,
    exdate: row.exdate,
    transparency,
    status,
  };
}

function toExceptions(masterId: string, rows: MasterRow["exceptions"]): EventException[] {
  const out: EventException[] = [];
  for (const row of rows) {
    if (row.recurrenceId == null) continue;
    out.push({
      masterEventId: masterId,
      recurrenceId: row.recurrenceId,
      startAt: row.startAt,
      endAt: row.endAt,
      isAllDay: row.isAllDay,
      isCancelled: row.status === "cancelled",
      title: row.title,
    });
  }
  return out;
}

function decorate(
  row: EventInstance,
  calendar: CalendarMeta,
  from: Date,
  to: Date,
): VisibleInstance | null {
  if (row.isCancelled || !calendar.isVisible) return null;
  if (!overlaps(row.startAt, row.endAt, from, to)) return null;
  return {
    ...row,
    calendarId: calendar.id,
    color: calendarColor(calendar.color),
    calendarName: calendar.name,
  };
}

function sortByStart(rows: VisibleInstance[]): VisibleInstance[] {
  return rows.sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime() || a.endAt.getTime() - b.endAt.getTime(),
  );
}

async function loadFromInstanceTable(
  userId: string,
  from: Date,
  to: Date,
): Promise<VisibleInstance[]> {
  const rows = (await db.calendarEventInstance.findMany({
    where: {
      userId,
      isCancelled: false,
      startAt: { lt: to },
      endAt: { gt: from },
      calendar: { isVisible: true },
    },
    include: {
      event: { select: { title: true } },
      calendar: { select: { id: true, name: true, color: true, isVisible: true } },
    },
    orderBy: { startAt: "asc" },
  })) as InstanceRow[];

  const out: VisibleInstance[] = [];
  for (const row of rows) {
    const mapped = decorate(
      {
        eventId: row.eventId,
        startAt: row.startAt,
        endAt: row.endAt,
        isAllDay: row.isAllDay,
        isCancelled: row.isCancelled,
        isException: row.isException,
        title: row.event.title,
      },
      row.calendar,
      from,
      to,
    );
    if (mapped) out.push(mapped);
  }
  return sortByStart(out);
}

async function expandVisibleMasters(
  userId: string,
  from: Date,
  to: Date,
): Promise<VisibleInstance[]> {
  const masters = (await db.calendarEvent.findMany({
    where: {
      userId,
      masterEventId: null,
      recurrenceId: null,
      calendar: { isVisible: true },
      OR: [{ rrule: { not: null } }, { startAt: { lt: to } }],
    },
    include: {
      exceptions: true,
      calendar: { select: { id: true, name: true, color: true, isVisible: true } },
    },
  })) as MasterRow[];

  const out: VisibleInstance[] = [];
  for (const master of masters) {
    if (!master.calendar.isVisible) continue;
    const expanded = expandEventWindow(
      toEventMaster(master),
      toExceptions(master.id, master.exceptions),
      from,
      to,
    );
    for (const row of expanded) {
      const mapped = decorate(row, master.calendar, from, to);
      if (mapped) out.push(mapped);
    }
    if (
      !master.rrule &&
      !master.rdate &&
      master.status !== "cancelled" &&
      overlaps(master.startAt, master.endAt, from, to)
    ) {
      const already = out.some(
        (row) =>
          row.eventId === master.id &&
          row.startAt.getTime() === master.startAt.getTime(),
      );
      if (!already) {
        const mapped = decorate(
          {
            eventId: master.id,
            startAt: master.startAt,
            endAt: master.endAt,
            isAllDay: master.isAllDay,
            isCancelled: false,
            isException: false,
            title: master.title,
          },
          master.calendar,
          from,
          to,
        );
        if (mapped) out.push(mapped);
      }
    }
  }
  return sortByStart(out);
}

export async function listVisibleInstancesForUser(
  userId: string,
  from: Date,
  to: Date,
  now: Date = new Date(),
): Promise<VisibleInstance[]> {
  if (needsOnTheFlyExpand(from, to, instanceWindow(now))) {
    return expandVisibleMasters(userId, from, to);
  }
  return loadFromInstanceTable(userId, from, to);
}
