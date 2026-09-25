import {
  availabilityForDay,
  DEFAULT_AVAILABILITY,
  type CalendarAvailability,
} from "@/lib/calendar/availability";
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

function dayBounds(day: CivilDate, timeZone: string): { from: Date; to: Date } {
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

/** A timed event's start and end in minutes from the day's local midnight, clamped to the day. */
export function minutesOnDay(
  instance: CalendarInstanceDTO,
  day: CivilDate,
  timeZone: string,
): { startMin: number; endMin: number } {
  return {
    startMin: minutesFromDayStart(new Date(instance.startAt), day, timeZone),
    endMin: minutesFromDayStart(new Date(instance.endAt), day, timeZone),
  };
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
    const startMin = minutesFromDayStart(new Date(inst.startAt), day, timeZone);
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

/**
 * The day's available window in minutes from local midnight, or null when
 * the day is set as not available. Open time is only counted inside it.
 */
export function dayWindow(
  availability: CalendarAvailability,
  day: CivilDate,
): { startMin: number; endMin: number } | null {
  const hours = availabilityForDay(availability, day);
  return hours.on ? { startMin: hours.start, endMin: hours.end } : null;
}

/**
 * Holes between busy events inside the day's available window; a day that
 * is off has none. `minMinutes` defaults to the free-time threshold, which
 * is what every "claim this" surface wants. The agenda asks for a lower one
 * to find the short gaps between events - too small to recommend, still
 * big enough to put a meeting in.
 */
export function freetimeMinutes(
  instances: CalendarInstanceDTO[],
  day: CivilDate,
  timeZone: string,
  availability: CalendarAvailability = DEFAULT_AVAILABILITY,
  minMinutes: number = FREETIME_MIN_MINUTES,
): { startMin: number; endMin: number }[] {
  const hours = dayWindow(availability, day);
  if (!hours) return [];
  const dayStart = wallFromMinutes(day, hours.startMin, timeZone);
  const dayEnd = wallFromMinutes(day, hours.endMin, timeZone);
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
    minMinutes,
  );
  return spans.map((span) => ({
    startMin: minutesFromDayStart(span.startAt, day, timeZone),
    endMin: minutesFromDayStart(span.endAt, day, timeZone),
  }));
}

/** Total open time on a day: the sum of its counted spans. */
export function openMinutesOnDay(
  instances: CalendarInstanceDTO[],
  day: CivilDate,
  timeZone: string,
  availability: CalendarAvailability,
): number {
  return freetimeMinutes(instances, day, timeZone, availability).reduce(
    (sum, span) => sum + span.endMin - span.startMin,
    0,
  );
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
  const end = civilFromZoned(
    new Date(Math.max(endMs, new Date(instance.startAt).getTime())),
    timeZone,
  );
  return { start, end };
}

export function isMultiDayEvent(
  instance: CalendarInstanceDTO,
  timeZone: string,
): boolean {
  const range = eventInclusiveRange(instance, timeZone);
  return compareCivil(range.start, range.end) < 0;
}

/**
 * Column widths in percent of the day area. A week that contains today
 * gives today a wide column (40%) and splits the rest evenly; any other
 * week is seven equal columns.
 */
export function weekColumnWidths(
  days: CivilDate[],
  today: CivilDate,
): number[] {
  const todayIndex = days.findIndex((day) => sameCivil(day, today));
  if (todayIndex === -1) return days.map(() => 100 / days.length);
  const narrow = 60 / (days.length - 1);
  return days.map((_, i) => (i === todayIndex ? 40 : narrow));
}

/**
 * First-fit lanes for bars that cover whole columns (multi-day events in
 * the week's all-day row and the month grid). Items are placed in the
 * order given; one that fits in no lane below `maxLanes` gets null and is
 * counted as more by the caller.
 */
export function packLanes(
  items: { startCol: number; endCol: number }[],
  maxLanes: number,
): (number | null)[] {
  const lanes: { startCol: number; endCol: number }[][] = [];
  return items.map((item) => {
    let lane = lanes.findIndex((taken) =>
      taken.every(
        (other) => item.endCol < other.startCol || item.startCol > other.endCol,
      ),
    );
    if (lane === -1) {
      if (lanes.length >= maxLanes) return null;
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane].push(item);
    return lane;
  });
}
