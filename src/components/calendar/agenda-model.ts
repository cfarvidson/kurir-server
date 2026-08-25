import {
  allDayEventsOnDay,
  freetimeMinutes,
  placeTimedEvents,
} from "@/components/calendar/grid-model";
import type { CalendarInstanceDTO } from "@/components/calendar/types";
import {
  BOOKABLE_GAP_MIN_MINUTES,
  FREETIME_MIN_MINUTES,
  formatDurationLabel,
  formatTimeLabel,
  type CivilDate,
} from "@/lib/calendar/view-time";

/**
 * One row in a day's agenda: an event, a free span, or a short bookable
 * gap. Port of the apps' CalendarAgendaModel (kurir-ios) — "free time is
 * a row" is a property of the model, not something views agree on.
 */
type AgendaRowBase = {
  id: string;
  /**
   * Minutes from local midnight. All-day rows sit at ALL_DAY_START_MIN so
   * they sort first.
   */
  startMin: number;
  endMin: number;
  /** "09:00", or null for an all-day row. */
  timeLabel: string | null;
  /** "30 min" or "All-day". Null when the row has nothing to say. */
  durationLabel: string | null;
};

export type AgendaRow =
  | (AgendaRowBase & { kind: "event"; instance: CalendarInstanceDTO })
  | (AgendaRowBase & {
      kind: "free";
      minutes: number;
      /** The day's longest hole names itself in the design. */
      isLongest: boolean;
    })
  | (AgendaRowBase & {
      /**
       * A hole too short to recommend but long enough to fill. Drawn
       * quietly - the claim capsule means "this is worth your time", and a
       * fifteen-minute gap is not making that claim.
       */
      kind: "gap";
      minutes: number;
    });

/**
 * Before midnight, so all-day rows always sort first without any view
 * special-casing.
 */
export const ALL_DAY_START_MIN = -1;

function minuteLabel(startMin: number): string {
  return formatTimeLabel(Math.floor(startMin / 60), startMin % 60);
}

export function agendaRows(
  instances: CalendarInstanceDTO[],
  day: CivilDate,
  timeZone: string,
): AgendaRow[] {
  // All-day rows in title order. They are not re-sorted afterwards - a
  // final sort on id would silently throw that order away.
  const allDayRows: AgendaRow[] = allDayEventsOnDay(instances, day, timeZone)
    .slice()
    .sort((a, b) =>
      a.title === b.title
        ? a.eventId.localeCompare(b.eventId)
        : a.title.localeCompare(b.title),
    )
    .map((event) => ({
      kind: "event",
      instance: event,
      id: `e_${event.eventId}:${event.startAt}`,
      startMin: ALL_DAY_START_MIN,
      endMin: ALL_DAY_START_MIN,
      timeLabel: null,
      durationLabel: "All-day",
    }));

  // Everything with a clock time: events and free spans in one timeline.
  const timeline: AgendaRow[] = [];

  // Placement clips the event to the day and to at least 15 minutes,
  // which is exactly the minutes the row should show.
  for (const placed of placeTimedEvents(instances, day, timeZone)) {
    timeline.push({
      kind: "event",
      instance: placed,
      id: `e_${placed.eventId}:${placed.startAt}`,
      startMin: placed.startMin,
      endMin: placed.endMin,
      timeLabel: minuteLabel(placed.startMin),
      durationLabel: formatDurationLabel(
        Math.max(placed.endMin - placed.startMin, 0),
      ),
    });
  }

  // One pass at the low threshold finds every hole worth filling; the
  // free-time cut then splits them into "worth your time" and "somewhere
  // to put a meeting". Asking twice would risk the two lists disagreeing
  // and offering the same minutes as both.
  const holes = freetimeMinutes(
    instances,
    day,
    timeZone,
    BOOKABLE_GAP_MIN_MINUTES,
  ).map((hole) => ({ ...hole, minutes: hole.endMin - hole.startMin }));
  const spans = holes.filter((hole) => hole.minutes >= FREETIME_MIN_MINUTES);
  for (const hole of holes) {
    if (hole.minutes >= FREETIME_MIN_MINUTES) continue;
    timeline.push({
      kind: "gap",
      minutes: hole.minutes,
      id: `g_${hole.startMin}_${hole.endMin}`,
      startMin: hole.startMin,
      endMin: hole.endMin,
      timeLabel: minuteLabel(hole.startMin),
      durationLabel: formatDurationLabel(hole.minutes),
    });
  }
  // Ties keep the first span, so exactly one row is ever flagged.
  let longest: (typeof spans)[number] | null = null;
  for (const span of spans) {
    if (!longest || span.minutes > longest.minutes) longest = span;
  }
  for (const span of spans) {
    timeline.push({
      kind: "free",
      minutes: span.minutes,
      isLongest: span === longest,
      id: `f_${span.startMin}_${span.endMin}`,
      startMin: span.startMin,
      endMin: span.endMin,
      timeLabel: minuteLabel(span.startMin),
      durationLabel: null,
    });
  }

  timeline.sort((a, b) =>
    a.startMin !== b.startMin
      ? a.startMin - b.startMin
      : a.id.localeCompare(b.id),
  );
  return [...allDayRows, ...timeline];
}

/**
 * The now-line goes before the first row that starts after now, else
 * last. A row that starts exactly now counts as already underway and
 * sorts before the line.
 */
export function nowRowIndex(rows: AgendaRow[], nowMinutes: number): number {
  const index = rows.findIndex((row) => row.startMin > nowMinutes);
  return index === -1 ? rows.length : index;
}
