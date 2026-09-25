import {
  dayWindow,
  freetimeMinutes,
  openMinutesOnDay,
} from "@/components/calendar/grid-model";
import type {
  CalendarInstanceDTO,
  CalendarViewMode,
} from "@/components/calendar/types";
import type { CalendarAvailability } from "@/lib/calendar/availability";
import {
  civilFromZoned,
  formatDurationLabel,
  formatTimeLabel,
  formatWeekdayLong,
  isoWeekNumber,
  monthGridDays,
  sameCivil,
  weekDays,
  zonedParts,
  type CivilDate,
} from "@/lib/calendar/view-time";

/** "Calendar · week 39", "Calendar · weeks 36–41", "Calendar · today" / "Calendar · Saturday". */
export function headerEyebrow(
  mode: CalendarViewMode,
  anchor: CivilDate,
  today: CivilDate,
): string {
  if (mode === "week") return `Calendar · week ${isoWeekNumber(anchor)}`;
  if (mode === "month") {
    const grid = monthGridDays(anchor);
    return `Calendar · weeks ${isoWeekNumber(grid[0])}–${isoWeekNumber(grid[grid.length - 1])}`;
  }
  return sameCivil(anchor, today)
    ? "Calendar · today"
    : `Calendar · ${formatWeekdayLong(anchor)}`;
}

function openHours(minutes: number): string {
  return minutes === 0 ? "0 h" : formatDurationLabel(minutes);
}

/**
 * The accent half of the meta line. Week: the shown week's total. Day: the
 * shown day. Month: today. `todayInstances` covers today whatever the view
 * shows; `instances` covers the view's own range.
 */
export function openTimeMeta({
  mode,
  anchor,
  today,
  instances,
  todayInstances,
  timezone,
  availability,
}: {
  mode: CalendarViewMode;
  anchor: CivilDate;
  today: CivilDate;
  instances: CalendarInstanceDTO[];
  todayInstances: CalendarInstanceDTO[];
  timezone: string;
  availability: CalendarAvailability;
}): string {
  if (mode === "week") {
    const days = weekDays(anchor);
    const total = days.reduce(
      (sum, day) =>
        sum + openMinutesOnDay(instances, day, timezone, availability),
      0,
    );
    const which = days.some((day) => sameCivil(day, today))
      ? "this week"
      : `in week ${isoWeekNumber(anchor)}`;
    return `${openHours(total)} open ${which}`;
  }
  if (mode === "day" && !sameCivil(anchor, today)) {
    const minutes = openMinutesOnDay(instances, anchor, timezone, availability);
    return `${openHours(minutes)} open on ${formatWeekdayLong(anchor)}`;
  }
  const minutes = openMinutesOnDay(
    todayInstances,
    today,
    timezone,
    availability,
  );
  return `${openHours(minutes)} open today`;
}

/**
 * While now is inside a counted open span that ends at the next event,
 * the minute that event starts. Null when now is busy, outside the window,
 * or in a span that runs to the end of the day's window.
 */
export function freeUntil(
  instances: CalendarInstanceDTO[],
  day: CivilDate,
  timezone: string,
  availability: CalendarAvailability,
  nowMin: number,
): number | null {
  const hours = dayWindow(availability, day);
  if (!hours) return null;
  const span = freetimeMinutes(instances, day, timezone, availability).find(
    (s) => s.startMin <= nowMin && nowMin < s.endMin,
  );
  if (!span || span.endMin >= hours.endMin) return null;
  return span.endMin;
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/i;

/** The first http(s) link in the location, else in the description. */
export function joinUrl(instance: CalendarInstanceDTO): string | null {
  for (const text of [instance.location, instance.description]) {
    const match = text?.match(URL_PATTERN);
    if (match) return match[0];
  }
  return null;
}

export type UpNext = {
  instance: CalendarInstanceDTO;
  /** Whole minutes until it starts, at least 1. */
  minutesUntil: number;
  /** "14:00–14:30". */
  range: string;
  joinUrl: string | null;
};

/**
 * The next timed event that starts later today. Null when nothing else
 * starts today - the card hides rather than reaching into tomorrow.
 */
export function upNext(
  instances: CalendarInstanceDTO[],
  timezone: string,
  now: Date,
): UpNext | null {
  const today = civilFromZoned(now, timezone);
  const next = instances
    .filter((row) => {
      if (row.isAllDay) return false;
      const start = new Date(row.startAt);
      return start > now && sameCivil(civilFromZoned(start, timezone), today);
    })
    .sort(
      (a, b) =>
        new Date(a.startAt).getTime() - new Date(b.startAt).getTime() ||
        a.title.localeCompare(b.title),
    )[0];
  if (!next) return null;
  const start = zonedParts(new Date(next.startAt), timezone);
  const end = zonedParts(new Date(next.endAt), timezone);
  return {
    instance: next,
    minutesUntil: Math.max(
      1,
      Math.ceil((new Date(next.startAt).getTime() - now.getTime()) / 60_000),
    ),
    range: `${formatTimeLabel(start.hour, start.minute)}–${formatTimeLabel(end.hour, end.minute)}`,
    joinUrl: joinUrl(next),
  };
}
