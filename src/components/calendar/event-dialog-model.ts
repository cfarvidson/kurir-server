import {
  addDays,
  formatDateParam,
  formatTimeLabel,
  parseDateParam,
  zonedParts,
  zonedWallToUtc,
} from "@/lib/calendar/view-time";

/** The event dialog's start and end, as its date and time inputs hold them. */
export type DialogTimes = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
};

function instant(date: string, time: string, timezone: string): Date {
  const [hour, minute] = time.split(":").map(Number);
  return zonedWallToUtc(timezone, {
    ...parseDateParam(date, timezone),
    hour: hour || 0,
    minute: minute || 0,
  });
}

function dayNumber(date: string, timezone: string): number {
  const day = parseDateParam(date, timezone);
  return Date.UTC(day.year, day.month - 1, day.day) / 86_400_000;
}

/**
 * A new start day or time that keeps the event's length: the end moves with
 * it, as in the apps' editors. Through the wall clock in `timezone`, so a
 * day across a DST change keeps its times. An all-day event keeps its
 * number of days. A cleared start leaves the end alone.
 */
export function withStart(
  times: DialogTimes,
  next: { startDate?: string; startTime?: string },
  timezone: string,
): DialogTimes {
  const startDate = next.startDate ?? times.startDate;
  const startTime = next.startTime ?? times.startTime;
  // A start cleared mid-edit has nothing to count from, and once filled in
  // again there is no old start to measure the length by, so the end stays.
  const cleared = (date: string, time: string) =>
    !date || (!times.allDay && !time);
  if (cleared(startDate, startTime) || cleared(times.startDate, times.startTime)) {
    return { ...times, startDate, startTime };
  }
  if (times.allDay) {
    const days =
      dayNumber(times.endDate, timezone) - dayNumber(times.startDate, timezone);
    const endDate = formatDateParam(
      addDays(parseDateParam(startDate, timezone), Math.max(days, 0)),
    );
    return { ...times, startDate, startTime, endDate };
  }
  const length =
    instant(times.endDate, times.endTime, timezone).getTime() -
    instant(times.startDate, times.startTime, timezone).getTime();
  const end = zonedParts(
    new Date(
      instant(startDate, startTime, timezone).getTime() + Math.max(length, 0),
    ),
    timezone,
  );
  return {
    ...times,
    startDate,
    startTime,
    endDate: formatDateParam(end),
    endTime: formatTimeLabel(end.hour, end.minute),
  };
}
