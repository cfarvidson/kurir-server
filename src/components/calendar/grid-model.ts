import { freetimeSpans } from "@/lib/calendar/range";
import {
  addDays,
  civilFromAllDayUtc,
  civilFromZoned,
  DAY_MINUTES,
  FREETIME_MIN_MINUTES,
  HOUR_HEIGHT_PX,
  minutesFromDayStart,
  packTimedEvents,
  sameCivil,
  VISIBLE_HOUR_END,
  VISIBLE_HOUR_START,
  zonedWallToUtc,
  type CivilDate,
} from "@/lib/calendar/view-time";
import type { CalendarInstanceDTO } from "@/components/calendar/types";

export function pxFromMinutes(min: number): number {
  return (min / 60) * HOUR_HEIGHT_PX;
}

export function minutesFromPx(y: number): number {
  return (y / HOUR_HEIGHT_PX) * 60;
}

export function snapMinutes(min: number, step = 15): number {
  const snapped = Math.round(min / step) * step;
  return Math.max(0, Math.min(DAY_MINUTES, snapped));
}

export function civilKey(date: CivilDate): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function compareCivil(a: CivilDate, b: CivilDate): number {
  return civilKey(a).localeCompare(civilKey(b));
}

function dayBounds(
  day: CivilDate,
  timeZone: string,
): { from: Date; to: Date } {
  return {
    from: zonedWallToUtc(timeZone, { ...day, hour: 0, minute: 0 }),
    to: zonedWallToUtc(timeZone, { ...addDays(day, 1), hour: 0, minute: 0 }),
  };
}

export function allDayBounds(instance: CalendarInstanceDTO): {
  start: CivilDate;
  endExclusive: CivilDate;
} {
  const start = civilFromAllDayUtc(new Date(instance.startAt));
  let endExclusive = civilFromAllDayUtc(new Date(instance.endAt));
  if (compareCivil(endExclusive, start) <= 0) {
    endExclusive = addDays(start, 1);
  }
  return { start, endExclusive };
}

export function instanceOverlapsDay(
  instance: CalendarInstanceDTO,
  day: CivilDate,
  timeZone: string,
): boolean {
  if (instance.isAllDay) {
    const { start, endExclusive } = allDayBounds(instance);
    return compareCivil(day, start) >= 0 && compareCivil(day, endExclusive) < 0;
  }
  const start = new Date(instance.startAt);
  const end = new Date(instance.endAt);
  const { from, to } = dayBounds(day, timeZone);
  return start < to && from < end;
}

export function allDayEventsOnDay(
  instances: CalendarInstanceDTO[],
  day: CivilDate,
  timeZone: string,
): CalendarInstanceDTO[] {
  return instances.filter(
    (row) => row.isAllDay && instanceOverlapsDay(row, day, timeZone),
  );
}

export function timedEventsOnDay(
  instances: CalendarInstanceDTO[],
  day: CivilDate,
  timeZone: string,
): CalendarInstanceDTO[] {
  return instances.filter(
    (row) => !row.isAllDay && instanceOverlapsDay(row, day, timeZone),
  );
}

export type PlacedTimed = CalendarInstanceDTO & {
  startMin: number;
  endMin: number;
  col: number;
  cols: number;
};

export function placeTimedEvents(
  instances: CalendarInstanceDTO[],
  day: CivilDate,
  timeZone: string,
): PlacedTimed[] {
  const timed = timedEventsOnDay(instances, day, timeZone).map((inst) => {
    const startMin = minutesFromDayStart(
      new Date(inst.startAt),
      day,
      timeZone,
    );
    const endMin = minutesFromDayStart(new Date(inst.endAt), day, timeZone);
    return { inst, startMin, endMin: Math.max(endMin, startMin + 15) };
  });
  const packed = packTimedEvents(
    timed.map((row, i) => ({
      id: `${row.inst.eventId}:${row.startMin}:${i}`,
      startMin: row.startMin,
      endMin: row.endMin,
    })),
  );
  return packed.map((row, i) => ({
    ...timed[i].inst,
    startMin: row.startMin,
    endMin: row.endMin,
    col: row.col,
    cols: row.cols,
  }));
}

export function freetimeMinutes(
  instances: CalendarInstanceDTO[],
  day: CivilDate,
  timeZone: string,
): { startMin: number; endMin: number }[] {
  const dayStart = zonedWallToUtc(timeZone, {
    ...day,
    hour: VISIBLE_HOUR_START,
    minute: 0,
  });
  const dayEnd = zonedWallToUtc(timeZone, {
    ...day,
    hour: VISIBLE_HOUR_END,
    minute: 0,
  });
  const spans = freetimeSpans(
    instances
      .filter((row) => instanceOverlapsDay(row, day, timeZone))
      .map((row) => ({
        startAt: new Date(row.startAt),
        endAt: new Date(row.endAt),
        isAllDay: row.isAllDay,
        isCancelled: false,
        transparency: row.transparency,
      })),
    dayStart,
    dayEnd,
    FREETIME_MIN_MINUTES,
  );
  return spans.map((span) => ({
    startMin: minutesFromDayStart(span.startAt, day, timeZone),
    endMin: minutesFromDayStart(span.endAt, day, timeZone),
  }));
}

export function nowMinutesOnDay(
  day: CivilDate,
  timeZone: string,
  now: Date,
): number | null {
  const wall = civilFromZoned(now, timeZone);
  if (!sameCivil(wall, day)) return null;
  return minutesFromDayStart(now, day, timeZone);
}

export function wallFromMinutes(
  day: CivilDate,
  minutes: number,
  timeZone: string,
): Date {
  const clamped = Math.max(0, Math.min(DAY_MINUTES, minutes));
  if (clamped >= DAY_MINUTES) {
    return zonedWallToUtc(timeZone, {
      ...addDays(day, 1),
      hour: 0,
      minute: 0,
    });
  }
  return zonedWallToUtc(timeZone, {
    ...day,
    hour: Math.floor(clamped / 60),
    minute: clamped % 60,
  });
}

export function eventInclusiveRange(
  instance: CalendarInstanceDTO,
  timeZone: string,
): { start: CivilDate; end: CivilDate } {
  if (instance.isAllDay) {
    const bounds = allDayBounds(instance);
    return { start: bounds.start, end: addDays(bounds.endExclusive, -1) };
  }
  const start = civilFromZoned(new Date(instance.startAt), timeZone);
  const endMs = new Date(instance.endAt).getTime() - 1;
  const end = civilFromZoned(new Date(Math.max(endMs, new Date(instance.startAt).getTime())), timeZone);
  return { start, end };
}

export function isMultiDayEvent(
  instance: CalendarInstanceDTO,
  timeZone: string,
): boolean {
  const range = eventInclusiveRange(instance, timeZone);
  return compareCivil(range.start, range.end) < 0;
}
