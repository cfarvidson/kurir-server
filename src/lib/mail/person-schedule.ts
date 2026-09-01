import { db } from "@/lib/db";
import { freetimeSpans } from "@/lib/calendar/range";
import {
  VISIBLE_HOUR_END,
  VISIBLE_HOUR_START,
  addDays,
  civilFromZoned,
  isWeekend,
  type CivilDate,
  weekdayIndex,
  zonedParts,
  zonedWallToUtc,
} from "@/lib/calendar/view-time";

export const SCHEDULE_MIN_MINUTES = 30;
export const SCHEDULE_WEEKDAY_COUNT = 7;
export const SCHEDULE_SUBJECT = "Time to meet?";
export const SCHEDULE_PACKED_BODY = "My week is packed. When works for you?";
export const SCHEDULE_OPEN_ASK = "Are you free any of these times?";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export type ScheduleDraft = {
  to: string;
  subject: string;
  body: string;
};

export type ScheduleInstance = {
  startAt: Date;
  endAt: Date;
  isAllDay: boolean;
  isCancelled: boolean;
  transparency: "busy" | "free";
};

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function nextWeekdays(now: Date, timeZone: string): CivilDate[] {
  let day = civilFromZoned(now, timeZone);
  const days: CivilDate[] = [];
  while (days.length < SCHEDULE_WEEKDAY_COUNT) {
    if (!isWeekend(day)) days.push(day);
    day = addDays(day, 1);
  }
  return days;
}

function formatSpan(startAt: Date, endAt: Date, timeZone: string): string {
  const start = zonedParts(startAt, timeZone);
  const end = zonedParts(endAt, timeZone);
  const weekday = WEEKDAYS[weekdayIndex({
    year: start.year,
    month: start.month,
    day: start.day,
  })];
  const month = MONTHS[start.month - 1];
  return `${weekday} ${start.day} ${month}, ${pad2(start.hour)}:${pad2(start.minute)}-${pad2(end.hour)}:${pad2(end.minute)}`;
}

export function slotLines(
  instances: ScheduleInstance[],
  now: Date,
  timeZone: string,
): string[] {
  const days = nextWeekdays(now, timeZone);
  const today = civilFromZoned(now, timeZone);
  const lines: string[] = [];
  for (const day of days) {
    let start = zonedWallToUtc(timeZone, {
      ...day,
      hour: VISIBLE_HOUR_START,
      minute: 0,
    });
    const end = zonedWallToUtc(timeZone, {
      ...day,
      hour: VISIBLE_HOUR_END,
      minute: 0,
    });
    if (
      day.year === today.year &&
      day.month === today.month &&
      day.day === today.day
    ) {
      if (now > start) start = now;
    }
    if (end.getTime() - start.getTime() < SCHEDULE_MIN_MINUTES * 60_000) {
      continue;
    }
    const spans = freetimeSpans(instances, start, end, SCHEDULE_MIN_MINUTES);
    for (const span of spans) {
      lines.push(formatSpan(span.startAt, span.endAt, timeZone));
    }
  }
  return lines;
}

export async function loadScheduleInstances(
  userId: string,
): Promise<ScheduleInstance[]> {
  const rows = await db.calendarEventInstance.findMany({
    where: { userId },
    select: {
      startAt: true,
      endAt: true,
      isAllDay: true,
      isCancelled: true,
      event: { select: { transparency: true } },
    },
  });
  return rows.map((row) => ({
    startAt: row.startAt,
    endAt: row.endAt,
    isAllDay: row.isAllDay,
    isCancelled: row.isCancelled,
    transparency: row.event.transparency === "free" ? "free" : "busy",
  }));
}

export function scheduleDraft(
  to: string,
  instances: ScheduleInstance[],
  now: Date,
  timeZone: string,
): ScheduleDraft {
  const lines = slotLines(instances, now, timeZone);
  return {
    to,
    subject: SCHEDULE_SUBJECT,
    body: lines.length === 0
      ? SCHEDULE_PACKED_BODY
      : [SCHEDULE_OPEN_ASK, "", ...lines].join("\n"),
  };
}
