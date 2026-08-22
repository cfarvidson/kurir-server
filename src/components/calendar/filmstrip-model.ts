import {
  allDayEventsOnDay,
  civilKey,
  compareCivil,
  freetimeMinutes,
  nowMinutesOnDay,
  placeTimedEvents,
} from "@/components/calendar/grid-model";
import {
  civilFromZoned,
  DAY_MINUTES,
  formatDurationLabel,
  formatTimeLabel,
  isWeekend,
  sameCivil,
  VISIBLE_HOUR_END,
  VISIBLE_HOUR_START,
  type CivilDate,
} from "@/lib/calendar/view-time";
import type { CalendarInstanceDTO } from "@/components/calendar/types";

/** Day window around the anchor: [anchor - WINDOW_BACK, anchor + WINDOW_FORWARD). */
export const WINDOW_BACK = 3;
export const WINDOW_FORWARD = 12; // exclusive end offset

/**
 * The strip is one continuous proportional timeline: daytime minutes map to
 * pixels at PX_PER_MIN, and empty night runs collapse to a fixed-width dark
 * band (HEY's filmstrip). Events at night keep the proportional scale — only
 * empty night time collapses.
 */
export const PX_PER_MIN = 1;
export const NIGHT_RUN_PX = 36;
export const MIN_SLAT_PX = 32;
export const DAY_START_MIN = VISIBLE_HOUR_START * 60;
export const DAY_END_MIN = VISIBLE_HOUR_END * 60;
/** Empty night runs shorter than this stay proportional instead of collapsing. */
const NIGHT_COLLAPSE_MIN = 60;

/** One piece of a day's minute -> pixel mapping. Contiguous from 0 to 24 h. */
export type StripSpan = {
  fromMin: number;
  toMin: number;
  fromPx: number;
  toPx: number;
  collapsed: boolean;
};

export type FilmstripSlat = {
  instance: CalendarInstanceDTO;
  startMin: number;
  endMin: number;
  xPx: number;
  widthPx: number;
  lane: number;
  lanes: number;
  startLabel: string; // "09:00"
  durationLabel: string; // "1 h"
};

export type FreetimeZone = {
  startMin: number;
  endMin: number;
  minutes: number;
  xPx: number;
  widthPx: number;
};

export type HourTick = { hour: number; xPx: number };

export type NightBand = { xPx: number; widthPx: number; edge: "lead" | "trail" };

export type FilmstripDay = {
  date: CivilDate;
  key: string; // "YYYY-MM-DD"
  isToday: boolean;
  isWeekend: boolean;
  isPast: boolean; // civil day strictly before today
  widthPx: number;
  spans: StripSpan[]; // the day's minute -> pixel mapping (for drag math)
  allDay: CalendarInstanceDTO[];
  slats: FilmstripSlat[];
  freetime: FreetimeZone[];
  hourTicks: HourTick[];
  nights: [NightBand, NightBand]; // lead (00-07), trail (21-24)
  nowXPx: number | null; // only set when isToday
  nowTimeLabel: string | null; // "13:37" when now is set
};

type MinuteSpan = { startMin: number; endMin: number };

function mergeNightClusters(
  events: MinuteSpan[],
  from: number,
  to: number,
): MinuteSpan[] {
  const clipped = events
    .map((e) => ({
      startMin: Math.max(e.startMin, from),
      endMin: Math.min(e.endMin, to),
    }))
    .filter((c) => c.endMin > c.startMin)
    .sort((a, b) => a.startMin - b.startMin);
  const merged: MinuteSpan[] = [];
  for (const c of clipped) {
    const last = merged[merged.length - 1];
    if (last && c.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, c.endMin);
    } else {
      merged.push({ ...c });
    }
  }
  return merged;
}

function nightPieces(
  events: MinuteSpan[],
  from: number,
  to: number,
): { fromMin: number; toMin: number; collapsed: boolean }[] {
  const clusters = mergeNightClusters(events, from, to);
  const out: { fromMin: number; toMin: number; collapsed: boolean }[] = [];
  let cursor = from;
  for (const cluster of clusters) {
    if (cluster.startMin > cursor) {
      out.push({
        fromMin: cursor,
        toMin: cluster.startMin,
        collapsed: cluster.startMin - cursor >= NIGHT_COLLAPSE_MIN,
      });
    }
    out.push({
      fromMin: cluster.startMin,
      toMin: cluster.endMin,
      collapsed: false,
    });
    cursor = cluster.endMin;
  }
  if (cursor < to) {
    out.push({
      fromMin: cursor,
      toMin: to,
      collapsed: to - cursor >= NIGHT_COLLAPSE_MIN,
    });
  }
  return out;
}

/** Piecewise minute -> pixel mapping for one day (00:00-24:00). */
export function buildDaySpans(events: MinuteSpan[]): StripSpan[] {
  const pieces = [
    ...nightPieces(events, 0, DAY_START_MIN),
    { fromMin: DAY_START_MIN, toMin: DAY_END_MIN, collapsed: false },
    ...nightPieces(events, DAY_END_MIN, DAY_MINUTES),
  ];
  let px = 0;
  return pieces.map((piece) => {
    const width = piece.collapsed
      ? NIGHT_RUN_PX
      : (piece.toMin - piece.fromMin) * PX_PER_MIN;
    const span = { ...piece, fromPx: px, toPx: px + width };
    px += width;
    return span;
  });
}

export function xForMinute(spans: StripSpan[], minute: number): number {
  const m = Math.max(0, Math.min(DAY_MINUTES, minute));
  for (const span of spans) {
    if (m <= span.toMin) {
      const duration = span.toMin - span.fromMin;
      if (duration <= 0) return span.fromPx;
      return span.fromPx + ((m - span.fromMin) / duration) * (span.toPx - span.fromPx);
    }
  }
  return spans.length > 0 ? spans[spans.length - 1].toPx : 0;
}

/** Inverse of xForMinute: pixel offset within a day -> minute (unsnapped). */
export function minuteForX(spans: StripSpan[], xPx: number): number {
  if (spans.length === 0) return 0;
  const total = spans[spans.length - 1].toPx;
  const x = Math.max(0, Math.min(total, xPx));
  for (const span of spans) {
    if (x <= span.toPx) {
      const width = span.toPx - span.fromPx;
      if (width <= 0) return span.fromMin;
      return (
        span.fromMin + ((x - span.fromPx) / width) * (span.toMin - span.fromMin)
      );
    }
  }
  return DAY_MINUTES;
}

/**
 * Variable-width scroll math. Day widths come out of the model, so the
 * pixel offset of each day is a prefix sum — the only DOM read the strip
 * needs is the first section's offset (`base`).
 */
export function stripDayOffsets(widths: number[]): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (const width of widths) {
    offsets.push(acc);
    acc += width;
  }
  return offsets;
}

export function stripIndexAtOffset(
  probePx: number,
  base: number,
  offsets: number[],
): number {
  if (offsets.length === 0) return 0;
  const x = probePx - base;
  let index = 0;
  for (let i = 1; i < offsets.length; i++) {
    if (offsets[i] <= x) index = i;
    else break;
  }
  return index;
}

export function stripOffsetForIndex(
  index: number,
  base: number,
  offsets: number[],
): number {
  return Math.max(0, base + (offsets[index] ?? 0));
}

export function buildFilmstrip(
  instances: CalendarInstanceDTO[],
  days: CivilDate[],
  timezone: string,
  now: Date,
): FilmstripDay[] {
  const today = civilFromZoned(now, timezone);
  return days.map((day) => {
    const placed = placeTimedEvents(instances, day, timezone);
    const spans = buildDaySpans(placed);
    const widthPx = spans.length > 0 ? spans[spans.length - 1].toPx : 0;
    const slats: FilmstripSlat[] = placed.map((row) => {
      const xPx = xForMinute(spans, row.startMin);
      // Positions are day-clipped, but the label states the event's true
      // span so a midnight-crosser doesn't read as two shorter events.
      const spanMin = Math.round(
        (new Date(row.endAt).getTime() - new Date(row.startAt).getTime()) /
          60_000,
      );
      return {
        instance: row,
        startMin: row.startMin,
        endMin: row.endMin,
        xPx,
        widthPx: Math.max(xForMinute(spans, row.endMin) - xPx, MIN_SLAT_PX),
        lane: row.col,
        lanes: row.cols,
        startLabel: formatTimeLabel(
          Math.floor(row.startMin / 60),
          row.startMin % 60,
        ),
        durationLabel: formatDurationLabel(spanMin),
      };
    });
    const freetime: FreetimeZone[] = freetimeMinutes(
      instances,
      day,
      timezone,
    ).map((gap) => {
      const xPx = xForMinute(spans, gap.startMin);
      return {
        startMin: gap.startMin,
        endMin: gap.endMin,
        minutes: gap.endMin - gap.startMin,
        xPx,
        widthPx: xForMinute(spans, gap.endMin) - xPx,
      };
    });
    const hourTicks: HourTick[] = [];
    for (let hour = VISIBLE_HOUR_START; hour < VISIBLE_HOUR_END; hour++) {
      hourTicks.push({ hour, xPx: xForMinute(spans, hour * 60) });
    }
    const dayStartX = xForMinute(spans, DAY_START_MIN);
    const dayEndX = xForMinute(spans, DAY_END_MIN);
    const isToday = sameCivil(day, today);
    const nowMin = isToday ? nowMinutesOnDay(day, timezone, now) : null;
    return {
      date: day,
      key: civilKey(day),
      isToday,
      isWeekend: isWeekend(day),
      isPast: compareCivil(day, today) < 0,
      widthPx,
      spans,
      allDay: allDayEventsOnDay(instances, day, timezone),
      slats,
      freetime,
      hourTicks,
      nights: [
        { xPx: 0, widthPx: dayStartX, edge: "lead" },
        { xPx: dayEndX, widthPx: widthPx - dayEndX, edge: "trail" },
      ],
      nowXPx: nowMin == null ? null : xForMinute(spans, nowMin),
      nowTimeLabel:
        nowMin == null
          ? null
          : formatTimeLabel(Math.floor(nowMin / 60), Math.floor(nowMin % 60)),
    };
  });
}
