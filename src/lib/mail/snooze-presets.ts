/**
 * Snooze picker presets. Same labels, times, and order as iOS/macOS
 * `SnoozePreset` in kurir-ios MessageListView.swift.
 */

export type SnoozePresetId =
  | "laterToday"
  | "tomorrow"
  | "dayAfter"
  | "inThreeDays"
  | "weekend"
  | "nextWeek"
  | "custom";

export type SnoozePreset = {
  id: SnoozePresetId;
  label: string;
  description: string;
  until: Date | null;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

const WEEKDAY_TO_JS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month) - 1,
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: WEEKDAY_TO_JS[map.weekday] ?? 0,
  };
}

export function buildDateInTimezone(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  let utc = Date.UTC(year, month, day, hour, minute, 0);
  for (let i = 0; i < 2; i++) {
    const got = zonedParts(new Date(utc), timeZone);
    const wanted = Date.UTC(year, month, day, hour, minute);
    const actual = Date.UTC(
      got.year,
      got.month,
      got.day,
      got.hour,
      got.minute,
    );
    utc += wanted - actual;
  }
  return new Date(utc);
}

function addDays(
  parts: ZonedParts,
  days: number,
  timeZone: string,
  hour: number,
  minute: number,
): Date {
  return buildDateInTimezone(
    timeZone,
    parts.year,
    parts.month,
    parts.day + days,
    hour,
    minute,
  );
}

/** `days` calendar days from `now`, pinned to 08:00 in `timeZone`. */
export function morningInDays(
  now: Date,
  timeZone: string,
  days: number,
): Date {
  return addDays(zonedParts(now, timeZone), days, timeZone, 8, 0);
}

/** Next occurrence of `weekday` (0=Sun) after `now`, then pin to hour:minute. */
function nextWeekday(
  now: Date,
  timeZone: string,
  weekday: number,
  hour: number,
  minute: number,
): Date {
  const parts = zonedParts(now, timeZone);
  let delta = (weekday - parts.weekday + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(parts, delta, timeZone, hour, minute);
}

function formatTime(date: Date, timeZone: string): string {
  return date.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function weekdayName(date: Date, timeZone: string): string {
  return date.toLocaleDateString("en-US", {
    timeZone,
    weekday: "long",
  });
}

function isoDate(parts: ZonedParts): string {
  const y = String(parts.year).padStart(4, "0");
  const m = String(parts.month + 1).padStart(2, "0");
  const d = String(parts.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Dated presets in chronological order, then "Pick a date…". */
export function listSnoozePresets(
  now: Date,
  timeZone: string,
): SnoozePreset[] {
  const laterToday = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const tomorrow = morningInDays(now, timeZone, 1);
  const dayAfter = morningInDays(now, timeZone, 2);
  const inThreeDays = morningInDays(now, timeZone, 3);
  const weekend = nextWeekday(now, timeZone, 6, 8, 0);
  const nextWeek = nextWeekday(now, timeZone, 1, 8, 0);

  const dated: SnoozePreset[] = [
    {
      id: "laterToday",
      label: "Later today",
      description: formatTime(laterToday, timeZone),
      until: laterToday,
    },
    {
      id: "tomorrow",
      label: "Tomorrow",
      description: "8:00 AM",
      until: tomorrow,
    },
    {
      id: "dayAfter",
      label: weekdayName(dayAfter, timeZone),
      description: "8:00 AM",
      until: dayAfter,
    },
    {
      id: "inThreeDays",
      label: weekdayName(inThreeDays, timeZone),
      description: "8:00 AM",
      until: inThreeDays,
    },
    {
      id: "weekend",
      label: "This weekend",
      description: "Saturday 8:00 AM",
      until: weekend,
    },
    {
      id: "nextWeek",
      label: "Next week",
      description: "Monday 8:00 AM",
      until: nextWeek,
    },
  ];

  dated.sort((a, b) => {
    const aTime = a.until?.getTime() ?? Number.POSITIVE_INFINITY;
    const bTime = b.until?.getTime() ?? Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });

  dated.push({
    id: "custom",
    label: "Pick a date…",
    description: "",
    until: null,
  });

  return dated;
}

/** Tomorrow 08:00 in `timeZone`, matching native SnoozeDatePickerView. */
export function defaultCustomSnooze(
  now: Date,
  timeZone: string,
): { date: string; time: string } {
  const parts = zonedParts(now, timeZone);
  const tomorrow = addDays(parts, 1, timeZone, 8, 0);
  return { date: isoDate(zonedParts(tomorrow, timeZone)), time: "08:00" };
}

export function todayIsoDate(now: Date, timeZone: string): string {
  return isoDate(zonedParts(now, timeZone));
}
