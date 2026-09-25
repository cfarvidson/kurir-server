import type { CalendarInstanceDTO } from "@/components/calendar/types";
import {
  civilFromAllDayUtc,
  civilFromZoned,
  formatDateParam,
  formatTimeLabel,
  zonedParts,
} from "@/lib/calendar/view-time";

export type NextUp = {
  title: string;
  /** Start time in the user's timezone, "09:30". */
  time: string;
  /** "Now", "in 20 min", or null when the start is an hour or more away. */
  when: string | null;
  color: string;
};

export type TodayRow = {
  key: string;
  title: string;
  /** "All day" or the start time, "09:30". */
  time: string;
  color: string;
  isPast: boolean;
};

/**
 * The event the sidebar's Next up card shows: the first timed event that
 * has not ended. All-day events are never "up next". Mirrors
 * `SidebarToday.nextUp` in kurir-ios.
 */
export function pickNextUp(
  instances: CalendarInstanceDTO[],
  now: Date,
  timeZone: string,
): NextUp | null {
  const next = instances
    .filter((i) => !i.isAllDay && new Date(i.endAt) > now)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0];
  if (!next) return null;
  const start = new Date(next.startAt);
  const wall = zonedParts(start, timeZone);
  return {
    title: next.title,
    time: formatTimeLabel(wall.hour, wall.minute),
    when: nextUpWhen(start, now),
    color: next.color,
  };
}

export function nextUpWhen(start: Date, now: Date): string | null {
  const minutes = Math.ceil((start.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "Now";
  if (minutes < 60) return `in ${minutes} min`;
  return null;
}

/**
 * Today's events for the Calendar panel: all-day first, then by start.
 * All-day rows are stored at UTC midnight, so a local day range also
 * catches yesterday's; keep only those whose civil dates cover today.
 */
export function todayRows(
  instances: CalendarInstanceDTO[],
  now: Date,
  timeZone: string,
): TodayRow[] {
  const today = formatDateParam(civilFromZoned(now, timeZone));
  const civil = (iso: string) =>
    formatDateParam(civilFromAllDayUtc(new Date(iso)));
  return instances
    .filter(
      (i) =>
        !i.isAllDay || (civil(i.startAt) <= today && civil(i.endAt) > today),
    )
    .sort(
      (a, b) =>
        Number(b.isAllDay) - Number(a.isAllDay) ||
        Date.parse(a.startAt) - Date.parse(b.startAt),
    )
    .map((i) => {
      const wall = zonedParts(new Date(i.startAt), timeZone);
      return {
        key: `${i.eventId}:${i.startAt}`,
        title: i.title,
        time: i.isAllDay ? "All day" : formatTimeLabel(wall.hour, wall.minute),
        color: i.color,
        isPast: !i.isAllDay && new Date(i.endAt) <= now,
      };
    });
}
