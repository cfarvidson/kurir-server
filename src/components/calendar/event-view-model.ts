import { compareCivil, eventInclusiveRange } from "@/components/calendar/grid-model";
import type { CalendarInstanceDTO } from "@/components/calendar/types";
import {
  formatDurationLabel,
  formatLongDate,
  formatTimeLabel,
  formatWeekdayLong,
  rrulePreset,
  zonedParts,
} from "@/lib/calendar/view-time";

/**
 * The time rail beside When/Where: start over end, the duration under them.
 * An all-day event has no clock times, so the rail says so and leaves the
 * dates to the When column. Same text as the apps' CalendarEventDetail.
 */
export type EventRail = {
  start: string;
  end: string | null;
  note: string | null;
};

export function eventRail(
  event: CalendarInstanceDTO,
  timeZone: string,
): EventRail {
  if (event.isAllDay) return { start: "All-day", end: null, note: null };
  const range = eventInclusiveRange(event, timeZone);
  const start = zonedParts(new Date(event.startAt), timeZone);
  const end = zonedParts(new Date(event.endAt), timeZone);
  let endLabel = formatTimeLabel(end.hour, end.minute);
  // An event ending on midnight belongs to the day it started on, and
  // "22:00 - 00:00" reads backwards there.
  if (
    compareCivil(range.start, range.end) === 0 &&
    compareCivil(end, range.start) !== 0 &&
    end.hour === 0 &&
    end.minute === 0
  ) {
    endLabel = "24:00";
  }
  const minutes = Math.round(
    (new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) /
      60_000,
  );
  return {
    start: formatTimeLabel(start.hour, start.minute),
    end: endLabel,
    note: minutes > 0 ? formatDurationLabel(minutes) : null,
  };
}

/** "Thursday 1 October", or both dates when the event spans days. */
export function eventWhenDate(
  event: CalendarInstanceDTO,
  timeZone: string,
): string {
  const range = eventInclusiveRange(event, timeZone);
  const start = formatLongDate(range.start);
  if (compareCivil(range.start, range.end) === 0) return start;
  return `${start} - ${formatLongDate(range.end)}`;
}

/**
 * The popover's one line: "Thursday 1 October · 16:20 - 17:05",
 * "… · All-day", or both dates and times when the event spans days.
 */
export function eventWhenLine(
  event: CalendarInstanceDTO,
  timeZone: string,
): string {
  const range = eventInclusiveRange(event, timeZone);
  const oneDay = compareCivil(range.start, range.end) === 0;
  if (event.isAllDay) {
    return oneDay
      ? `${formatLongDate(range.start)} · All-day`
      : eventWhenDate(event, timeZone);
  }
  const rail = eventRail(event, timeZone);
  if (oneDay) {
    return `${formatLongDate(range.start)} · ${rail.start} - ${rail.end}`;
  }
  return `${formatLongDate(range.start)} ${rail.start} - ${formatLongDate(range.end)} ${rail.end}`;
}

/**
 * Null when the event does not repeat. "Repeats" for rules the editor
 * cannot express: guessing at "Yearly on August 19" would be making it up.
 */
export function eventRepeatLine(
  event: CalendarInstanceDTO,
  timeZone: string,
): string | null {
  switch (rrulePreset(event.rrule)) {
    case "daily":
      return "Every day";
    case "weekly":
      return `Weekly on ${formatWeekdayLong(eventInclusiveRange(event, timeZone).start)}s`;
    case "weekdays":
      return "Every weekday";
    case "monthly":
      return "Monthly";
    case "custom":
      return "Repeats";
    default:
      return null;
  }
}

export type NoteSegment = { text: string; href?: string };

const LINK =
  /\b(?:https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/gi;
const TRAILING = /[.,;:!?)\]'"]+$/;

/**
 * The notes split into text and links: web addresses and email addresses
 * become links, so a meeting link in the notes opens in one click.
 */
export function noteSegments(text: string): NoteSegment[] {
  const segments: NoteSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const raw = match[0];
    const trimmed = raw.replace(TRAILING, "");
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: text.slice(last, index) });
    const href = trimmed.includes("@") && !/^(https?:|www\.)/i.test(trimmed)
      ? `mailto:${trimmed}`
      : /^www\./i.test(trimmed)
        ? `https://${trimmed}`
        : trimmed;
    segments.push({ text: trimmed, href });
    last = index + trimmed.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
