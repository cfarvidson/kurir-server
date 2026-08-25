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
  | (AgendaRowBase & {
      kind: "event";
      instance: CalendarInstanceDTO;
      /** Now falls inside this event. Marked on the row, never a line. */
      isNow: boolean;
    })
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

type Hole = { startMin: number; endMin: number; minutes: number };

/**
 * A hole that straddles now loses its elapsed portion: the row shows
 * what is still on offer, and claiming it books time that starts now.
 */
function clipToNow(hole: Hole, nowMin: number | null): Hole {
  if (nowMin == null || nowMin <= hole.startMin || nowMin >= hole.endMin) {
    return hole;
  }
  return { startMin: nowMin, endMin: hole.endMin, minutes: hole.endMin - nowMin };
}

/** Minutes of the hole not yet behind now. Off-day, all of them. */
function remainingMinutes(hole: Hole, nowMin: number | null): number {
  if (nowMin == null) return hole.minutes;
  return Math.max(Math.min(hole.endMin - nowMin, hole.minutes), 0);
}

/**
 * `nowMin` is now as minutes from local midnight when `day` is today,
 * null otherwise. Injected rather than read from the clock so the model
 * stays deterministic. On today, holes straddling now are clipped, the
 * longest stretch is chosen by remaining minutes, and the ongoing event
 * row is flagged; any other day renders untouched.
 */
export function agendaRows(
  instances: CalendarInstanceDTO[],
  day: CivilDate,
  timeZone: string,
  nowMin: number | null = null,
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
      // All-day rows are never "ongoing" - the badge would sit there all
      // day and mean nothing.
      isNow: false,
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
      isNow:
        nowMin != null && placed.startMin <= nowMin && nowMin < placed.endMin,
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
  // A hole keeps its kind from its original size - what it is - while
  // clipping decides what it still offers.
  const holes: Hole[] = freetimeMinutes(
    instances,
    day,
    timeZone,
    BOOKABLE_GAP_MIN_MINUTES,
  ).map((hole) => ({ ...hole, minutes: hole.endMin - hole.startMin }));
  const spans = holes.filter((hole) => hole.minutes >= FREETIME_MIN_MINUTES);
  for (const hole of holes) {
    if (hole.minutes >= FREETIME_MIN_MINUTES) continue;
    const gap = clipToNow(hole, nowMin);
    timeline.push({
      kind: "gap",
      minutes: gap.minutes,
      id: `g_${gap.startMin}_${gap.endMin}`,
      startMin: gap.startMin,
      endMin: gap.endMin,
      timeLabel: minuteLabel(gap.startMin),
      durationLabel: formatDurationLabel(gap.minutes),
    });
  }
  // Ties keep the first span, so exactly one row is ever flagged. On
  // today the contest is over remaining minutes - a span mostly behind
  // now cannot claim to be the longest stretch, and when nothing remains
  // no span is flagged at all.
  let longest: (typeof spans)[number] | null = null;
  for (const span of spans) {
    if (remainingMinutes(span, nowMin) <= 0) continue;
    if (
      !longest ||
      remainingMinutes(span, nowMin) > remainingMinutes(longest, nowMin)
    ) {
      longest = span;
    }
  }
  for (const span of spans) {
    const free = clipToNow(span, nowMin);
    timeline.push({
      kind: "free",
      minutes: free.minutes,
      isLongest: span === longest,
      id: `f_${free.startMin}_${free.endMin}`,
      startMin: free.startMin,
      endMin: free.endMin,
      timeLabel: minuteLabel(free.startMin),
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
 * Where the now-line goes in rows already built with the same now: right
 * at the now boundary, before the first row that starts at or after it,
 * else last. Null when now falls inside an ongoing event - that row
 * carries the marking, and a line there would read as "this is over".
 * Expects rows from `agendaRows(..., nowMin)`; unclipped rows would put
 * the line mid-span.
 */
export function nowLineIndex(
  rows: AgendaRow[],
  nowMinutes: number,
): number | null {
  const ongoing = rows.some(
    (row) =>
      row.kind === "event" &&
      row.startMin !== ALL_DAY_START_MIN &&
      row.startMin <= nowMinutes &&
      nowMinutes < row.endMin,
  );
  if (ongoing) return null;
  const index = rows.findIndex((row) => row.startMin >= nowMinutes);
  return index === -1 ? rows.length : index;
}
