import type {
  CalendarAccountDTO,
  CalendarInstanceDTO,
} from "@/components/calendar/types";
import type { TravelStart } from "@/lib/calendar/travel";
import { formatDurationLabel } from "@/lib/calendar/view-time";

/** The editor's Travel time and Travel after steps, as in the apps. */
const TRAVEL_STEPS = [5, 15, 30, 45, 60, 90, 120];

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

type ScheduledEvent = {
  id: string;
  startMin: number;
  endMin: number;
  instance: CalendarInstanceDTO;
};

/** A row of the day's Scheduled list: an event, or its travel. */
export type ScheduledRow<E extends ScheduledEvent> = {
  id: string;
  kind: "travelBefore" | "event" | "travelAfter";
  event: E;
  /** When to leave, when the event starts, or when it ends. */
  startMin: number;
  minutes: number;
  /** "Travel from Home", "Travel", "Travel after"; null for the event. */
  travelLabel: string | null;
};

/**
 * The day's Scheduled list: each event, with its travel as rows of their
 * own right above it (when to leave) and right below it (the way back).
 * Travel is cut at the day's edges. Port of the apps' scheduledRows.
 */
export function scheduledRows<E extends ScheduledEvent>(
  events: E[],
): ScheduledRow<E>[] {
  return events.flatMap((event) => {
    const before = Math.min(event.instance.travelMinutes ?? 0, event.startMin);
    const after = Math.min(
      event.instance.travelAfterMinutes ?? 0,
      24 * 60 - event.endMin,
    );
    const place = travelPlace(event.instance.travelStart);
    const rows: ScheduledRow<E>[] = [];
    if (before > 0) {
      rows.push({
        id: `${event.id}-before`,
        kind: "travelBefore",
        event,
        startMin: event.startMin - before,
        minutes: before,
        travelLabel: place ? `Travel from ${place}` : "Travel",
      });
    }
    rows.push({
      id: event.id,
      kind: "event",
      event,
      startMin: event.startMin,
      minutes: event.endMin - event.startMin,
      travelLabel: null,
    });
    if (after > 0) {
      rows.push({
        id: `${event.id}-after`,
        kind: "travelAfter",
        event,
        startMin: event.endMin,
        minutes: after,
        travelLabel: "Travel after",
      });
    }
    return rows;
  });
}
