export type CivilDate = {
  year: number;
  month: number;
  day: number;
};

export type WallTime = CivilDate & {
  hour: number;
  minute: number;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const VISIBLE_HOUR_START = 7;
export const VISIBLE_HOUR_END = 21;
export const FREETIME_MIN_MINUTES = 120;
/**
 * The smallest hole the agenda offers as a bookable gap row. Below this a
 * hole is the walk between meetings, not an opportunity.
 */
export const BOOKABLE_GAP_MIN_MINUTES = 15;
export const HOUR_HEIGHT_PX = 48;
export const DAY_MINUTES = 24 * 60;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function formatDateParam(date: CivilDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

export function formatHourLabel(hour: number): string {
  return `${pad2(hour)}:00`;
}

export function isWeekend(date: CivilDate): boolean {
  const dow = weekdayIndex(date);
  return dow === 0 || dow === 6;
}

export function weekdayIndex(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function addDays(date: CivilDate, days: number): CivilDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

export function startOfWeekMonday(date: CivilDate): CivilDate {
  const dow = weekdayIndex(date);
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDays(date, offset);
}

export function startOfMonth(date: CivilDate): CivilDate {
  return { year: date.year, month: date.month, day: 1 };
}

export function addMonths(date: CivilDate, months: number): CivilDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: Math.min(date.day, lastDay),
  };
}

// Constructing an Intl.DateTimeFormat is expensive and zonedParts runs per
// event, per day, per render — keep one formatter per timezone.
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

export function zonedParts(date: Date, timeZone: string): WallTime {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export function civilFromZoned(date: Date, timeZone: string): CivilDate {
  const p = zonedParts(date, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

export function sameCivil(a: CivilDate, b: CivilDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC Date.
 * Iterates to correct the UTC offset (DST-safe).
 */
export function zonedWallToUtc(timeZone: string, wall: WallTime): Date {
  const desired = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    0,
  );
  let instant = new Date(desired);
  for (let i = 0; i < 3; i++) {
    const asZone = zonedParts(instant, timeZone);
    const actual = Date.UTC(
      asZone.year,
      asZone.month - 1,
      asZone.day,
      asZone.hour,
      asZone.minute,
      0,
    );
    const delta = desired - actual;
    if (delta === 0) return instant;
    instant = new Date(instant.getTime() + delta);
  }
  return instant;
}

export function parseDateParam(
  value: string | undefined | null,
  timeZone: string,
  now: Date = new Date(),
): CivilDate {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return { year, month, day };
  }
  return civilFromZoned(now, timeZone);
}

export function weekDays(anchor: CivilDate): CivilDate[] {
  const start = startOfWeekMonday(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function monthGridDays(anchor: CivilDate): CivilDate[] {
  const start = startOfWeekMonday(startOfMonth(anchor));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function rangeUtc(
  start: CivilDate,
  endExclusive: CivilDate,
  timeZone: string,
): { from: Date; to: Date } {
  return {
    from: zonedWallToUtc(timeZone, { ...start, hour: 0, minute: 0 }),
    to: zonedWallToUtc(timeZone, { ...endExclusive, hour: 0, minute: 0 }),
  };
}

export function weekRangeUtc(
  anchor: CivilDate,
  timeZone: string,
): { from: Date; to: Date; days: CivilDate[] } {
  const days = weekDays(anchor);
  const { from, to } = rangeUtc(days[0], addDays(days[6], 1), timeZone);
  return { from, to, days };
}

export function dayRangeUtc(
  anchor: CivilDate,
  timeZone: string,
): { from: Date; to: Date } {
  return rangeUtc(anchor, addDays(anchor, 1), timeZone);
}

export function monthRangeUtc(
  anchor: CivilDate,
  timeZone: string,
): { from: Date; to: Date; days: CivilDate[] } {
  const days = monthGridDays(anchor);
  const { from, to } = rangeUtc(days[0], addDays(days[41], 1), timeZone);
  return { from, to, days };
}

export function formatWeekTitle(days: CivilDate[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  const startMonth = MONTHS[first.month - 1];
  if (first.month === last.month && first.year === last.year) {
    return `${startMonth} ${first.day}-${last.day}`;
  }
  const endMonth = MONTHS[last.month - 1];
  if (first.year === last.year) {
    return `${startMonth} ${first.day}-${endMonth} ${last.day}`;
  }
  return `${startMonth} ${first.day}, ${first.year}-${endMonth} ${last.day}, ${last.year}`;
}

export function formatDayTitle(date: CivilDate): string {
  const weekday = WEEKDAYS_LONG[weekdayIndex(date)];
  return `${weekday}, ${MONTHS[date.month - 1]} ${date.day}`;
}

export function formatMonthTitle(date: CivilDate): string {
  return `${MONTHS[date.month - 1]} ${date.year}`;
}

export function formatWeekdayShort(date: CivilDate): string {
  return WEEKDAYS_SHORT[weekdayIndex(date)];
}

export function formatTimeLabel(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** All-day civil date from stored UTC midnight. Do not zone-shift. */
export function civilFromAllDayUtc(startAt: Date): CivilDate {
  return {
    year: startAt.getUTCFullYear(),
    month: startAt.getUTCMonth() + 1,
    day: startAt.getUTCDate(),
  };
}

export function allDayRangeUtc(
  start: CivilDate,
  endExclusive: CivilDate,
): { startAt: Date; endAt: Date } {
  return {
    startAt: new Date(Date.UTC(start.year, start.month - 1, start.day)),
    endAt: new Date(
      Date.UTC(endExclusive.year, endExclusive.month - 1, endExclusive.day),
    ),
  };
}

export function minutesFromDayStart(
  instant: Date,
  day: CivilDate,
  timeZone: string,
): number {
  const wall = zonedParts(instant, timeZone);
  const wallCivil = { year: wall.year, month: wall.month, day: wall.day };
  if (sameCivil(wallCivil, day)) {
    return wall.hour * 60 + wall.minute;
  }
  if (
    wall.year < day.year ||
    (wall.year === day.year && wall.month < day.month) ||
    (wall.year === day.year && wall.month === day.month && wall.day < day.day)
  ) {
    return 0;
  }
  return DAY_MINUTES;
}

export type TimedBlock = {
  id: string;
  startMin: number;
  endMin: number;
};

export type PackedTimedBlock = TimedBlock & {
  col: number;
  cols: number;
};

export function packTimedEvents(blocks: TimedBlock[]): PackedTimedBlock[] {
  const items = blocks
    .map((b, i) => ({
      ...b,
      endMin: Math.max(b.endMin, b.startMin + 15),
      index: i,
    }))
    .sort(
      (a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.index - b.index,
    );

  type Laid = (typeof items)[number] & { col: number; cols: number };
  const laid: Laid[] = [];
  const active: Laid[] = [];
  let group: Laid[] = [];
  let groupEnd = -1;

  function closeGroup() {
    if (group.length === 0) return;
    const cols = Math.max(...group.map((g) => g.col)) + 1;
    for (const g of group) g.cols = cols;
    group = [];
    groupEnd = -1;
  }

  for (const item of items) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].endMin <= item.startMin) active.splice(i, 1);
    }
    if (group.length > 0 && item.startMin >= groupEnd) {
      closeGroup();
      active.length = 0;
    }
    const used = new Set(active.map((a) => a.col));
    let col = 0;
    while (used.has(col)) col += 1;
    const next: Laid = { ...item, col, cols: 1 };
    laid.push(next);
    active.push(next);
    group.push(next);
    groupEnd = Math.max(groupEnd, item.endMin);
  }
  closeGroup();

  const byIndex = new Map(laid.map((l) => [l.index, l]));
  return items.map((item) => {
    const found = byIndex.get(item.index)!;
    return {
      id: found.id,
      startMin: found.startMin,
      endMin: found.endMin,
      col: found.col,
      cols: found.cols,
    };
  });
}

export function rrulePreset(rrule: string | null): string {
  if (!rrule) return "";
  const value = rrule.replace(/^RRULE:/i, "").toUpperCase();
  if (value === "FREQ=DAILY") return "daily";
  if (value === "FREQ=WEEKLY") return "weekly";
  if (value === "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR") return "weekdays";
  if (value === "FREQ=MONTHLY") return "monthly";
  return "custom";
}

export function rruleFromPreset(preset: string): string | null {
  switch (preset) {
    case "daily":
      return "FREQ=DAILY";
    case "weekly":
      return "FREQ=WEEKLY";
    case "weekdays":
      return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "monthly":
      return "FREQ=MONTHLY";
    default:
      return null;
  }
}

export function formatDurationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `${hours} h`;
  if (rem === 30) return `${hours}.5 h`;
  return `${hours} h ${rem} min`;
}

export function formatFreetimeLabel(minutes: number): string {
  return `${formatDurationLabel(minutes)} free`;
}
