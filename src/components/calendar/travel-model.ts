import type { CalendarAccountDTO } from "@/components/calendar/types";
import type { TravelStart } from "@/lib/calendar/travel";
import { formatDurationLabel } from "@/lib/calendar/view-time";

/** The editor's Travel time steps, as in the apps. */
const TRAVEL_STEPS = [5, 15, 30, 60, 90, 120];

export type TravelOption = { value: number | null; label: string };

/**
 * None and the steps. A current length that is not a step (Apple Calendar
 * computes travel from an address, e.g. 25 min) gets its own option.
 */
export function travelOptions(current: number | null): TravelOption[] {
  const steps =
    current && !TRAVEL_STEPS.includes(current)
      ? [...TRAVEL_STEPS, current].sort((a, b) => a - b)
      : TRAVEL_STEPS;
  return [
    { value: null, label: "None" },
    ...steps.map((value) => ({ value, label: formatDurationLabel(value) })),
  ];
}

/** Where travel starts, in a word: the place's name, else its address's first line. */
export function travelPlace(
  start: TravelStart | null | undefined,
): string | null {
  return start?.title?.trim() || start?.address?.split("\n")[0]?.trim() || null;
}

/**
 * Travel time lives on the event only in CalDAV (Apple Calendar's
 * X-APPLE-TRAVEL-* lines); Google and Outlook have no such field.
 */
export function calendarHasTravelTime(
  accounts: Pick<CalendarAccountDTO, "provider" | "calendars">[],
  calendarId: string,
): boolean {
  return accounts.some(
    (account) =>
      account.provider === "CALDAV" &&
      account.calendars.some((calendar) => calendar.id === calendarId),
  );
}
