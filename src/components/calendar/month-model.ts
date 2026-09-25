import {
  dayWindow,
  freetimeMinutes,
  minutesOnDay,
  timedEventsOnDay,
} from "@/components/calendar/grid-model";
import type { CalendarInstanceDTO } from "@/components/calendar/types";
import type { CalendarAvailability } from "@/lib/calendar/availability";
import { normalizeEventHex } from "@/lib/calendar/color";
import { formatDurationLabel, type CivilDate } from "@/lib/calendar/view-time";

/** A stretch of the load bar, as fractions (0-1) of the day's window. */
export type LoadSegment = { start: number; width: number };

/**
 * The month cell's load bar: the day's available window from left to
 * right, busy events in their calendar colour, counted open spans
 * (>= FREETIME_MIN_MINUTES) as accent, and whatever is left - short gaps -
 * as the neutral track. A day that is off is an empty track.
 */
export type LoadBar = {
  off: boolean;
  openMinutes: number;
  open: LoadSegment[];
  busy: (LoadSegment & { color: string })[];
};

export function loadBar(
  instances: CalendarInstanceDTO[],
  day: CivilDate,
  timeZone: string,
  availability: CalendarAvailability,
): LoadBar {
  const hours = dayWindow(availability, day);
  if (!hours) return { off: true, openMinutes: 0, open: [], busy: [] };
  const length = hours.endMin - hours.startMin;
  const segment = (startMin: number, endMin: number): LoadSegment => ({
    start: (startMin - hours.startMin) / length,
    width: (endMin - startMin) / length,
  });

  const spans = freetimeMinutes(instances, day, timeZone, availability);
  const busy = timedEventsOnDay(instances, day, timeZone)
    .filter((row) => row.transparency === "busy")
    .map((row) => {
      const { startMin, endMin } = minutesOnDay(row, day, timeZone);
      return {
        startMin: Math.max(startMin, hours.startMin),
        endMin: Math.min(endMin, hours.endMin),
        color: normalizeEventHex(row.color),
      };
    })
    .filter((row) => row.startMin < row.endMin)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  return {
    off: false,
    openMinutes: spans.reduce((sum, s) => sum + s.endMin - s.startMin, 0),
    open: spans.map((s) => segment(s.startMin, s.endMin)),
    busy: busy.map((b) => ({
      ...segment(b.startMin, b.endMin),
      color: b.color,
    })),
  };
}

/** "11.5 h", "4 h 20 min", "Full" when nothing counts, "Not available" when off. */
export function openLabel(bar: LoadBar): string {
  if (bar.off) return "Not available";
  if (bar.openMinutes === 0) return "Full";
  return formatDurationLabel(bar.openMinutes);
}
