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
  /** The meeting link, for Join; null when the event has none. */
  joinUrl: string | null;
  /**
   * "Leave 09:05": the start less the travel time. Null without travel
   * time, and once the event has started.
   */
  leave: string | null;
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
 * The event every Next up card shows (the sidebar's and the calendar
 * header's): the first timed event that has not ended, so an ongoing
 * meeting counts. All-day events are never "up next". Mirrors
 * `SidebarToday.nextUp` in kurir-ios.
 */
export function nextUpEvent(
  instances: CalendarInstanceDTO[],
  now: Date,
): CalendarInstanceDTO | null {
  return (
    instances
      .filter((i) => !i.isAllDay && new Date(i.endAt) > now)
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0] ?? null
  );
}

export function pickNextUp(
  instances: CalendarInstanceDTO[],
  now: Date,
  timeZone: string,
): NextUp | null {
  const next = nextUpEvent(instances, now);
  if (!next) return null;
  const start = new Date(next.startAt);
  const wall = zonedParts(start, timeZone);
  return {
    title: next.title,
    time: formatTimeLabel(wall.hour, wall.minute),
    when: nextUpWhen(start, now),
    color: next.color,
    joinUrl: joinUrl(next),
    leave: nextUpLeave(next, now, timeZone),
  };
}

/** "Leave 09:05" for an event with travel time that has not started. */
export function nextUpLeave(
  instance: CalendarInstanceDTO,
  now: Date,
  timeZone: string,
): string | null {
  const start = new Date(instance.startAt);
  if (instance.isAllDay || !instance.travelMinutes || now >= start) {
    return null;
  }
  const leaveAt = zonedParts(
    new Date(start.getTime() - instance.travelMinutes * 60_000),
    timeZone,
  );
  return `Leave ${formatTimeLabel(leaveAt.hour, leaveAt.minute)}`;
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
