"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { EventBlock } from "@/components/calendar/event-block";
import {
  compareCivil,
  eventInclusiveRange,
  isMultiDayEvent,
} from "@/components/calendar/grid-model";
import type { CalendarInstanceDTO } from "@/components/calendar/types";
import {
  addDays,
  civilFromZoned,
  formatDateParam,
  formatTimeLabel,
  isWeekend,
  monthGridDays,
  sameCivil,
  zonedParts,
  type CivilDate,
} from "@/lib/calendar/view-time";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MAX_LANES = 3;

function colInWeek(day: CivilDate, weekStart: CivilDate): number {
  let col = 0;
  let cursor = weekStart;
  while (compareCivil(cursor, day) < 0 && col < 6) {
    cursor = addDays(cursor, 1);
    col += 1;
  }
  return col;
}

function clipToWeek(
  start: CivilDate,
  end: CivilDate,
  weekStart: CivilDate,
): { startCol: number; span: number } | null {
  const weekEnd = addDays(weekStart, 6);
  if (compareCivil(end, weekStart) < 0 || compareCivil(start, weekEnd) > 0) {
    return null;
  }
  const clippedStart = compareCivil(start, weekStart) < 0 ? weekStart : start;
  const clippedEnd = compareCivil(end, weekEnd) > 0 ? weekEnd : end;
  const startCol = colInWeek(clippedStart, weekStart);
  const endCol = colInWeek(clippedEnd, weekStart);
  return { startCol, span: endCol - startCol + 1 };
}

function timeLabelFor(
  event: CalendarInstanceDTO,
  timeZone: string,
): string | undefined {
  if (event.isAllDay) return undefined;
  const wall = zonedParts(new Date(event.startAt), timeZone);
  return formatTimeLabel(wall.hour, wall.minute);
}

export function MonthView({
  anchor,
  instances,
  timezone,
  onEventClick,
}: {
  anchor: CivilDate;
  instances: CalendarInstanceDTO[];
  timezone: string;
  onEventClick: (event: CalendarInstanceDTO) => void;
}) {
  const router = useRouter();
  const days = useMemo(() => monthGridDays(anchor), [anchor]);
  const today = civilFromZoned(new Date(), timezone);
  const weeks = useMemo(() => {
    const rows: CivilDate[][] = [];
    for (let i = 0; i < 42; i += 7) rows.push(days.slice(i, i + 7));
    return rows;
  }, [days]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {WEEKDAYS.map((label, i) => (
          <div
            key={label}
            className={cn(
              "px-2 py-2 text-[11px] uppercase tracking-wide text-muted-foreground",
              (i === 5 || i === 6) && "bg-muted/40",
            )}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-6">
        {weeks.map((week) => (
          <MonthWeek
            key={formatDateParam(week[0])}
            week={week}
            anchor={anchor}
            today={today}
            instances={instances}
            timezone={timezone}
            onEventClick={onEventClick}
            onDayClick={(day) =>
              router.push(`/calendar/day?date=${formatDateParam(day)}`)
            }
          />
        ))}
      </div>
    </div>
  );
}

function MonthWeek({
  week,
  anchor,
  today,
  instances,
  timezone,
  onEventClick,
  onDayClick,
}: {
  week: CivilDate[];
  anchor: CivilDate;
  today: CivilDate;
  instances: CalendarInstanceDTO[];
  timezone: string;
  onEventClick: (event: CalendarInstanceDTO) => void;
  onDayClick: (day: CivilDate) => void;
}) {
  const weekStart = week[0];
  const weekEnd = week[6];

  const overlapping = instances.filter((event) => {
    const range = eventInclusiveRange(event, timezone);
    return (
      compareCivil(range.end, weekStart) >= 0 &&
      compareCivil(range.start, weekEnd) <= 0
    );
  });

  const spanning = overlapping
    .filter((event) => isMultiDayEvent(event, timezone))
    .sort((a, b) => {
      const aRange = eventInclusiveRange(a, timezone);
      const bRange = eventInclusiveRange(b, timezone);
      return (
        compareCivil(aRange.start, bRange.start) ||
        compareCivil(bRange.end, aRange.end)
      );
    });

  const singles = overlapping.filter(
    (event) => !isMultiDayEvent(event, timezone),
  );

  const lanes: Array<
    Array<{ event: CalendarInstanceDTO; startCol: number; endCol: number }>
  > = [];
  const overflow = Array.from({ length: 7 }, () => 0);

  function occupies(
    lane: Array<{ startCol: number; endCol: number }>,
    startCol: number,
    endCol: number,
  ): boolean {
    return lane.some(
      (row) => !(endCol < row.startCol || startCol > row.endCol),
    );
  }

  for (const event of spanning) {
    const range = eventInclusiveRange(event, timezone);
    const clipped = clipToWeek(range.start, range.end, weekStart);
    if (!clipped) continue;
    const endCol = clipped.startCol + clipped.span - 1;
    let laneIndex = lanes.findIndex(
      (lane) => !occupies(lane, clipped.startCol, endCol),
    );
    if (laneIndex === -1) {
      if (lanes.length >= MAX_LANES) {
        for (let col = clipped.startCol; col <= endCol; col++) {
          overflow[col] += 1;
        }
        continue;
      }
      laneIndex = lanes.length;
      lanes.push([]);
    }
    lanes[laneIndex].push({ event, startCol: clipped.startCol, endCol });
  }

  const leftovers: CalendarInstanceDTO[][] = Array.from(
    { length: 7 },
    () => [],
  );
  for (const event of singles) {
    const range = eventInclusiveRange(event, timezone);
    const clipped = clipToWeek(range.start, range.end, weekStart);
    if (!clipped) continue;
    leftovers[clipped.startCol].push(event);
  }

  const usedLanes = lanes.length;
  const remainingSlots = Math.max(0, MAX_LANES - usedLanes);

  return (
    <div className="flex min-h-0 flex-col border-b border-border">
      <div className="grid grid-cols-7">
        {week.map((day) => (
          <button
            key={formatDateParam(day)}
            type="button"
            onClick={() => onDayClick(day)}
            className={cn(
              "border-l border-border px-1.5 py-1 text-left font-serif text-base font-semibold leading-tight tabular-nums",
              isWeekend(day) && "bg-muted/40",
              day.month !== anchor.month && "font-normal text-muted-foreground/50",
              sameCivil(day, today) && "bg-primary/5 text-primary",
            )}
          >
            {sameCivil(day, today) ? (
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground">
                {day.day}
              </span>
            ) : (
              day.day
            )}
          </button>
        ))}
      </div>
      {lanes.map((lane, i) => (
        <div key={i} className="grid grid-cols-7 px-px">
          {laneItems(lane).map((item) =>
            item.kind === "empty" ? (
              <div
                key={`e-${item.startCol}`}
                style={{ gridColumn: `span ${item.span}` }}
              />
            ) : (
              <div
                key={`${item.event.eventId}:${item.startCol}`}
                className="px-px pb-0.5"
                style={{ gridColumn: `span ${item.span}` }}
              >
                <EventBlock
                  title={item.event.title}
                  color={item.event.color}
                  muted={item.event.transparency === "free"}
                  className="relative h-5"
                  onClick={() => onEventClick(item.event)}
                />
              </div>
            ),
          )}
        </div>
      ))}
      <div className="grid min-h-0 flex-1 grid-cols-7">
        {week.map((day, col) => {
          const shown = leftovers[col].slice(0, remainingSlots);
          const extra = leftovers[col].length - shown.length + overflow[col];
          return (
            <div
              key={formatDateParam(day)}
              className={cn(
                "min-h-0 border-l border-border px-px pb-1",
                isWeekend(day) && "bg-muted/40",
              )}
            >
              {shown.map((event) => (
                <EventBlock
                  key={`${event.eventId}:${event.startAt}`}
                  title={event.title}
                  color={event.color}
                  timeLabel={timeLabelFor(event, timezone)}
                  muted={event.transparency === "free"}
                  className="relative mb-0.5 h-5"
                  onClick={() => onEventClick(event)}
                />
              ))}
              {extra > 0 && (
                <button
                  type="button"
                  onClick={() => onDayClick(day)}
                  className="px-0.5 text-[11px] font-medium tabular-nums text-primary hover:underline"
                >
                  +{extra}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function laneItems(
  lane: Array<{ event: CalendarInstanceDTO; startCol: number; endCol: number }>,
): Array<
  | { kind: "bar"; event: CalendarInstanceDTO; startCol: number; span: number }
  | { kind: "empty"; startCol: number; span: number }
> {
  const items: Array<
    | { kind: "bar"; event: CalendarInstanceDTO; startCol: number; span: number }
    | { kind: "empty"; startCol: number; span: number }
  > = [];
  let cursor = 0;
  const sorted = [...lane].sort((a, b) => a.startCol - b.startCol);
  for (const row of sorted) {
    if (row.startCol > cursor) {
      items.push({
        kind: "empty",
        startCol: cursor,
        span: row.startCol - cursor,
      });
    }
    items.push({
      kind: "bar",
      event: row.event,
      startCol: row.startCol,
      span: row.endCol - row.startCol + 1,
    });
    cursor = row.endCol + 1;
  }
  if (cursor < 7) {
    items.push({ kind: "empty", startCol: cursor, span: 7 - cursor });
  }
  return items;
}
