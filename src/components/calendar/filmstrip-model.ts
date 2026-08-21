import {
  allDayEventsOnDay,
  civilKey,
  compareCivil,
  freetimeMinutes,
  nowMinutesOnDay,
  timedEventsOnDay,
} from "@/components/calendar/grid-model";
import {
  civilFromZoned,
  formatDurationLabel,
  formatTimeLabel,
  isWeekend,
  minutesFromDayStart,
  sameCivil,
  type CivilDate,
} from "@/lib/calendar/view-time";
import type { CalendarInstanceDTO } from "@/components/calendar/types";

/** Day window around the anchor: [anchor - WINDOW_BACK, anchor + WINDOW_FORWARD). */
export const WINDOW_BACK = 3;
export const WINDOW_FORWARD = 12; // exclusive end offset

export type FilmstripItem =
  | {
      kind: "event";
      instance: CalendarInstanceDTO;
      startMin: number;
      endMin: number;
      heightPx: number;
      startLabel: string; // "09:00"
      durationLabel: string; // "1 h"
    }
  | {
      kind: "freetime";
      startMin: number;
      endMin: number;
      heightPx: number;
      minutes: number; // endMin - startMin, for FreetimeBlock
    };

export type NowMarker =
  | { kind: "in-item"; index: number; fraction: number } // 0..1 within items[index]
  | { kind: "between"; beforeIndex: number }; // before items[beforeIndex]; items.length = after all items

export type FilmstripDay = {
  date: CivilDate;
  key: string; // "YYYY-MM-DD"
  isToday: boolean;
  isWeekend: boolean;
  isPast: boolean; // civil day strictly before today
  allDay: CalendarInstanceDTO[];
  items: FilmstripItem[]; // ordered by startMin
  now: NowMarker | null; // only set when isToday
  nowTimeLabel: string | null; // "13:37" when now is set, else null
};

export function entryHeightPx(minutes: number): number {
  return Math.round(Math.min(140, Math.max(40, 24 + minutes * 0.5)));
}

/**
 * Uniform-column scroll math. All day columns share one width, so position
 * <-> day index is plain arithmetic against the first column's offset
 * (`base`) and the column-to-column distance (`stride`) — no per-column
 * DOM measurement on scroll.
 */
export function stripIndexAtOffset(
  scrollLeft: number,
  base: number,
  stride: number,
  count: number,
): number {
  if (stride <= 0 || count <= 0) return 0;
  const raw = Math.round((scrollLeft - base) / stride);
  return Math.min(Math.max(raw, 0), count - 1);
}

export function stripOffsetForIndex(
  index: number,
  base: number,
  stride: number,
): number {
  return Math.max(0, base + index * stride);
}

function nowMarker(
  items: FilmstripItem[],
  nowMin: number | null,
): NowMarker | null {
  if (nowMin == null) return null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.startMin <= nowMin && nowMin < item.endMin) {
      return {
        kind: "in-item",
        index: i,
        fraction: (nowMin - item.startMin) / (item.endMin - item.startMin),
      };
    }
  }
  const before = items.findIndex((item) => item.startMin > nowMin);
  return {
    kind: "between",
    beforeIndex: before === -1 ? items.length : before,
  };
}

export function buildFilmstrip(
  instances: CalendarInstanceDTO[],
  days: CivilDate[],
  timezone: string,
  now: Date,
): FilmstripDay[] {
  const today = civilFromZoned(now, timezone);
  return days.map((day) => {
    const timed = timedEventsOnDay(instances, day, timezone).map(
      (instance) => {
        const startMin = minutesFromDayStart(
          new Date(instance.startAt),
          day,
          timezone,
        );
        const endMin = Math.max(
          minutesFromDayStart(new Date(instance.endAt), day, timezone),
          startMin + 15,
        );
        // Heights are day-clipped, but the label states the event's true
        // span so a midnight-crosser doesn't read as two shorter events.
        const spanMin = Math.round(
          (new Date(instance.endAt).getTime() -
            new Date(instance.startAt).getTime()) /
            60_000,
        );
        return {
          kind: "event" as const,
          instance,
          startMin,
          endMin,
          heightPx: entryHeightPx(endMin - startMin),
          startLabel: formatTimeLabel(
            Math.floor(startMin / 60),
            startMin % 60,
          ),
          durationLabel: formatDurationLabel(spanMin),
        };
      },
    );
    const free = freetimeMinutes(instances, day, timezone).map((gap) => ({
      kind: "freetime" as const,
      startMin: gap.startMin,
      endMin: gap.endMin,
      heightPx: entryHeightPx(gap.endMin - gap.startMin),
      minutes: gap.endMin - gap.startMin,
    }));
    const items: FilmstripItem[] = [...timed, ...free].sort((a, b) => {
      if (a.startMin !== b.startMin) return a.startMin - b.startMin;
      if (a.kind === "event" && b.kind === "event") return a.endMin - b.endMin;
      return (a.kind === "freetime" ? 1 : 0) - (b.kind === "freetime" ? 1 : 0);
    });
    const isToday = sameCivil(day, today);
    const nowMin = isToday ? nowMinutesOnDay(day, timezone, now) : null;
    return {
      date: day,
      key: civilKey(day),
      isToday,
      isWeekend: isWeekend(day),
      isPast: compareCivil(day, today) < 0,
      allDay: allDayEventsOnDay(instances, day, timezone),
      items,
      now: nowMarker(items, nowMin),
      nowTimeLabel:
        nowMin == null
          ? null
          : formatTimeLabel(Math.floor(nowMin / 60), Math.floor(nowMin % 60)),
    };
  });
}
