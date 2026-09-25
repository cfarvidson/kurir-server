import { z } from "zod";
import {
  VISIBLE_HOUR_END,
  VISIBLE_HOUR_START,
  type CivilDate,
} from "@/lib/calendar/view-time";

/**
 * The hours a person counts as their own, per weekday. Open time is only
 * counted inside a day's window, and the calendar shades the hours outside
 * it. `start`/`end` are wall-clock minutes after midnight in the account's
 * timezone, on 30-minute steps; a day that is off has no open time at all.
 *
 * Stored on `User.calendarAvailability` (null = never set) and delivered to
 * the apps on every `/api/mobile/calendar/sync` page, like the timezone.
 */
export type AvailabilityDay = { on: boolean; start: number; end: number };

/** Monday first, exactly seven entries. */
export type CalendarAvailability = { days: AvailabilityDay[] };

export const AVAILABILITY_STEP_MINUTES = 30;

const minutes = z
  .number()
  .int()
  .min(0)
  .max(24 * 60)
  .refine((m) => m % AVAILABILITY_STEP_MINUTES === 0, "30-minute steps");

const daySchema = z
  .object({ on: z.boolean(), start: minutes, end: minutes })
  .refine((d) => d.start < d.end, "start must be before end");

export const availabilitySchema = z.object({
  days: z.array(daySchema).length(7),
});

/** What every account had before the setting existed: 07-21, every day. */
export const DEFAULT_AVAILABILITY: CalendarAvailability = {
  days: Array.from({ length: 7 }, () => ({
    on: true,
    start: VISIBLE_HOUR_START * 60,
    end: VISIBLE_HOUR_END * 60,
  })),
};

/**
 * The stored value, or the default when it is missing or malformed. A bad
 * row must never break the calendar, so readers always get seven valid days.
 */
export function resolveAvailability(raw: unknown): CalendarAvailability {
  const parsed = availabilitySchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_AVAILABILITY;
}

/** Monday = 0 ... Sunday = 6, for a civil date. */
export function weekdayIndex(day: CivilDate): number {
  const sundayFirst = new Date(
    Date.UTC(day.year, day.month - 1, day.day),
  ).getUTCDay();
  return (sundayFirst + 6) % 7;
}

/** The window that applies on a civil date. */
export function availabilityForDay(
  availability: CalendarAvailability,
  day: CivilDate,
): AvailabilityDay {
  return availability.days[weekdayIndex(day)];
}
