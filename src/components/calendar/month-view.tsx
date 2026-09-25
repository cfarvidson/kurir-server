"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { EventBlock } from "@/components/calendar/event-block";
import {
  compareCivil,
  eventInclusiveRange,
  isMultiDayEvent,
  packLanes,
} from "@/components/calendar/grid-model";
import { loadBar, openLabel } from "@/components/calendar/month-model";
import type { CalendarInstanceDTO } from "@/components/calendar/types";
import type { CalendarAvailability } from "@/lib/calendar/availability";
import { normalizeEventHex } from "@/lib/calendar/color";
import {
  addDays,
  civilFromZoned,
  formatDateParam,
  formatTimeLabel,
  isoWeekNumber,
  isWeekend,
  monthGridDays,
  sameCivil,
  zonedParts,
  type CivilDate,
} from "@/lib/calendar/view-time";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
/** Multi-day bars stacked per week; more than this go into "N more". */
const MAX_LANES = 2;
/** Items per day under the bars: two, fewer for each bar crossing the day. */
const MAX_ITEMS = 2;
const COLUMNS =
  "grid-cols-[28px_repeat(7,minmax(0,1fr))] md:grid-cols-[48px_repeat(7,minmax(0,1fr))]";

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
): { startCol: number; endCol: number } | null {
  const weekEnd = addDays(weekStart, 6);
  if (compareCivil(end, weekStart) < 0 || compareCivil(start, weekEnd) > 0) {
    return null;
  }
  const clippedStart = compareCivil(start, weekStart) < 0 ? weekStart : start;
  const clippedEnd = compareCivil(end, weekEnd) > 0 ? weekEnd : end;
  return {
    startCol: colInWeek(clippedStart, weekStart),
    endCol: colInWeek(clippedEnd, weekStart),
  };
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
  availability,
  onEventClick,
}: {
  anchor: CivilDate;
  instances: CalendarInstanceDTO[];
  timezone: string;
  availability: CalendarAvailability;
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
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pb-4 md:px-10">
      <div className={cn("grid shrink-0 pt-2 pb-2", COLUMNS)}>
        <div className="text-[10.5px] font-semibold tracking-[0.1em] text-muted-foreground">
          WK
        </div>
        {WEEKDAYS.map((label) => (
          <div
            key={label}
            className="truncate pl-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[repeat(6,minmax(105px,1fr))]">
        {weeks.map((week, row) => (
          <MonthWeek
            key={formatDateParam(week[0])}
            week={week}
            first={row === 0}
            anchor={anchor}
            today={today}
            instances={instances}
            timezone={timezone}
            availability={availability}
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
  first,
  anchor,
  today,
  instances,
  timezone,
  availability,
  onEventClick,
  onDayClick,
}: {
  week: CivilDate[];
  first: boolean;
  anchor: CivilDate;
  today: CivilDate;
  instances: CalendarInstanceDTO[];
  timezone: string;
  availability: CalendarAvailability;
  onEventClick: (event: CalendarInstanceDTO) => void;
  onDayClick: (day: CivilDate) => void;
}) {
  const weekStart = week[0];
  const weekEnd = week[6];
  const isCurrentWeek = week.some((day) => sameCivil(day, today));

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
    })
    .flatMap((event) => {
      const range = eventInclusiveRange(event, timezone);
      const clipped = clipToWeek(range.start, range.end, weekStart);
      return clipped ? [{ event, end: range.end, ...clipped }] : [];
    });
  const lanes = packLanes(spanning, MAX_LANES);
  const bars = spanning.flatMap((bar, i) => {
    const lane = lanes[i];
    return lane == null ? [] : [{ ...bar, lane }];
  });

  // Per column: how many bar lanes cross it, and how many bars did not fit.
  const lanesAt = Array.from({ length: 7 }, () => 0);
  const overflow = Array.from({ length: 7 }, () => 0);
  spanning.forEach((bar, i) => {
    for (let col = bar.startCol; col <= bar.endCol; col++) {
      const lane = lanes[i];
      if (lane == null) overflow[col] += 1;
      else lanesAt[col] = Math.max(lanesAt[col], lane + 1);
    }
  });

  const singles: CalendarInstanceDTO[][] = Array.from({ length: 7 }, () => []);
  for (const event of overlapping) {
    if (isMultiDayEvent(event, timezone)) continue;
    const range = eventInclusiveRange(event, timezone);
    const clipped = clipToWeek(range.start, range.end, weekStart);
    if (clipped) singles[clipped.startCol].push(event);
  }
  for (const list of singles) {
    list.sort(
      (a, b) =>
        Number(b.isAllDay) - Number(a.isAllDay) ||
        new Date(a.startAt).getTime() - new Date(b.startAt).getTime() ||
        a.title.localeCompare(b.title),
    );
  }

  return (
    <div
      className={cn(
        "relative grid border-t",
        COLUMNS,
        first ? "border-foreground" : "border-foreground/15",
      )}
    >
      <div
        className={cn(
          "pt-[11px] text-[13px] font-bold tabular-nums md:text-[17px]",
          isCurrentWeek ? "text-primary" : "text-muted-foreground/60",
        )}
      >
        {isoWeekNumber(weekStart)}
      </div>
      {week.map((day, col) => {
        const isToday = sameCivil(day, today);
        const outside = day.month !== anchor.month;
        const past = compareCivil(day, today) < 0;
        const bar = loadBar(instances, day, timezone, availability);
        const cap = Math.max(0, MAX_ITEMS - lanesAt[col]);
        const shown = singles[col].slice(0, cap);
        const more = singles[col].length - shown.length + overflow[col];
        return (
          <div
            key={formatDateParam(day)}
            className={cn(
              "relative flex min-w-0 flex-col border-l border-border",
              isToday
                ? "bg-card dark:bg-secondary/55"
                : isWeekend(day) && "bg-foreground/[0.025]",
            )}
          >
            <div className="flex items-start justify-between gap-1 px-1 pt-[7px] md:px-2">
              <button
                type="button"
                onClick={() => onDayClick(day)}
                aria-label={`Open ${formatDateParam(day)}`}
                className={cn(
                  "flex h-[30px] min-w-8 items-center rounded-[7px] px-[5px] text-lg font-bold tracking-[-0.03em] tabular-nums md:text-2xl",
                  isToday
                    ? "bg-primary text-primary-foreground"
                    : outside
                      ? "text-muted-foreground/45"
                      : past && "opacity-50",
                )}
              >
                {day.day}
              </button>
              <span
                className={cn(
                  "hidden truncate pt-[9px] pr-0.5 text-[11px] font-semibold tabular-nums lg:block",
                  isToday
                    ? "text-primary"
                    : "text-[color-mix(in_srgb,var(--color-primary)_70%,var(--color-foreground))]",
                  outside ? "opacity-45" : past && "opacity-50",
                )}
              >
                {openLabel(bar)}
              </span>
            </div>
            <div
              className={cn(
                "relative mx-1 mt-[7px] h-1.5 overflow-hidden rounded-[3px] bg-border md:mx-2.5",
                outside ? "opacity-45" : past && "opacity-50",
              )}
            >
              {bar.open.map((segment) => (
                <span
                  key={`o${segment.start}`}
                  className="absolute inset-y-0 bg-primary/32"
                  style={{
                    left: `${segment.start * 100}%`,
                    width: `${segment.width * 100}%`,
                  }}
                />
              ))}
              {bar.busy.map((segment, i) => (
                <span
                  key={`b${i}`}
                  className="absolute inset-y-0 min-w-0.5"
                  style={{
                    left: `${segment.start * 100}%`,
                    width: `${segment.width * 100}%`,
                    backgroundColor: segment.color,
                  }}
                />
              ))}
            </div>
            <div
              className="mt-2 shrink-0"
              style={{ height: lanesAt[col] ? lanesAt[col] * 20 - 3 : 0 }}
            />
            <div
              className={cn(
                "flex min-w-0 flex-col gap-0.5 px-1 pb-1 md:px-2.5",
                outside ? "opacity-45" : past && "opacity-50",
              )}
            >
              {shown.map((event) => {
                const time = timeLabelFor(event, timezone);
                return (
                  <button
                    key={`${event.eventId}:${event.startAt}`}
                    type="button"
                    onClick={() => onEventClick(event)}
                    className="flex h-[15px] min-w-0 items-center gap-1.5 whitespace-nowrap text-left text-[11px] hover:opacity-80"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 shrink-0 rounded-[2px]",
                        event.transparency === "free" && "opacity-50",
                      )}
                      style={{
                        backgroundColor: normalizeEventHex(event.color),
                      }}
                    />
                    {time && (
                      <span className="hidden shrink-0 font-semibold tabular-nums text-muted-foreground md:inline">
                        {time}
                      </span>
                    )}
                    <span className="truncate font-medium">{event.title}</span>
                  </button>
                );
              })}
              {more > 0 && (
                <button
                  type="button"
                  onClick={() => onDayClick(day)}
                  className="h-[13px] text-left text-[10.5px] font-semibold tabular-nums text-muted-foreground hover:text-foreground"
                >
                  {more} more
                </button>
              )}
            </div>
          </div>
        );
      })}
      {bars.length > 0 && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-[55px] grid auto-rows-[20px]",
            COLUMNS,
          )}
        >
          {bars.map((bar) => (
            <div
              key={`${bar.event.eventId}:${bar.event.startAt}`}
              className="min-w-0 px-1"
              style={{
                gridColumn: `${bar.startCol + 2} / span ${bar.endCol - bar.startCol + 1}`,
                gridRow: bar.lane + 1,
              }}
            >
              <EventBlock
                title={bar.event.title}
                color={bar.event.color}
                muted={bar.event.transparency === "free"}
                className={cn(
                  "pointer-events-auto h-[17px] rounded-[4px] text-[11px]",
                  compareCivil(bar.end, today) < 0 && "opacity-50",
                )}
                onClick={() => onEventClick(bar.event)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
