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
  transparency: Transparency;
  location: string | null;
  description: string | null;
  rrule: string | null;
  isReadOnly: boolean;
};

type CalendarMeta = {
  id: string;
  name: string;
  color: string | null;
  isVisible: boolean;
  isReadOnly?: boolean;
};

type EventExtras = {
  transparency: string;
  location: string | null;
  description: string | null;
  rrule: string | null;
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
  location: string | null;
  description: string | null;
  calendarId: string;
  calendar: CalendarMeta;
  exceptions: Array<{
    recurrenceId: Date | null;
    startAt: Date;
    endAt: Date;
    isAllDay: boolean;
    status: string;
    title: string;
    location?: string | null;
    description?: string | null;
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
  event: { title: string } & Partial<EventExtras>;
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

function extrasFrom(
  extra: Partial<EventExtras> | null | undefined,
): Omit<EventExtras, "transparency"> & { transparency: Transparency } {
  return {
    transparency: extra?.transparency === "free" ? "free" : "busy",
    location: extra?.location ?? null,
    description: extra?.description ?? null,
    rrule: extra?.rrule ?? null,
  };
}

function matchingException(
  master: MasterRow,
  row: EventInstance,
): MasterRow["exceptions"][number] | null {
  if (!row.isException) return null;
  return (
    master.exceptions.find(
      (ex) =>
        ex.startAt.getTime() === row.startAt.getTime() &&
        ex.endAt.getTime() === row.endAt.getTime(),
    ) ??
    master.exceptions.find((ex) => ex.startAt.getTime() === row.startAt.getTime()) ??
    null
  );
}

function extrasForOccurrence(
  row: EventInstance,
  master: MasterRow,
): EventExtras {
  const base: EventExtras = {
    transparency: master.transparency,
    location: master.location,
    description: master.description,
    rrule: master.rrule,
  };
  const ex = matchingException(master, row);
  if (!ex) return base;
  return {
    transparency: master.transparency,
    location: ex.location ?? master.location,
    description: ex.description ?? master.description,
    rrule: master.rrule,
  };
}

function decorate(
  row: EventInstance,
  calendar: CalendarMeta,
  from: Date,
  to: Date,
  extra?: Partial<EventExtras>,
): VisibleInstance | null {
  if (row.isCancelled || !calendar.isVisible) return null;
  if (!overlaps(row.startAt, row.endAt, from, to)) return null;
  return {
    ...row,
    calendarId: calendar.id,
    color: calendarColor(calendar.color),
    calendarName: calendar.name,
    isReadOnly: calendar.isReadOnly === true,
    ...extrasFrom(extra),
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
      event: {
        select: {
          title: true,
          description: true,
          location: true,
          rrule: true,
          transparency: true,
        },
      },
      calendar: {
        select: {
          id: true,
          name: true,
          color: true,
          isVisible: true,
          isReadOnly: true,
        },
      },
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
      row.event,
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
      calendar: {
        select: {
          id: true,
          name: true,
          color: true,
          isVisible: true,
          isReadOnly: true,
        },
      },
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
    const extra: EventExtras = {
      transparency: master.transparency,
      location: master.location,
      description: master.description,
      rrule: master.rrule,
    };
    for (const row of expanded) {
      const mapped = decorate(
        row,
        master.calendar,
        from,
        to,
        extrasForOccurrence(row, master),
      );
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
          extra,
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
