"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { EventBlock } from "@/components/calendar/event-block";
import { FreetimeBlock } from "@/components/calendar/freetime-block";
import { openSpans } from "@/components/calendar/agenda-model";
import {
  compareCivil,
  dayWindow,
  eventInclusiveRange,
  minutesFromPx,
  nowMinutesOnDay,
  openMinutesOnDay,
  packLanes,
  placeTimedEvents,
  pxFromMinutes,
  snapMinutes,
  timedEventsOnDay,
  wallFromMinutes,
  weekColumnWidths,
} from "@/components/calendar/grid-model";
import {
  pointerPastThreshold,
  timedPlacementChanged,
} from "@/components/calendar/timed-drag";
import type {
  CalendarInstanceDTO,
  SlotSelection,
} from "@/components/calendar/types";
import type { CalendarAvailability } from "@/lib/calendar/availability";
import {
  DAY_MINUTES,
  HOUR_HEIGHT_PX,
  VISIBLE_HOUR_START,
  civilFromZoned,
  formatDateParam,
  formatDurationLabel,
  formatHourLabel,
  formatTimeLabel,
  formatWeekdayLong,
  formatWeekdayShort,
  sameCivil,
  type CivilDate,
} from "@/lib/calendar/view-time";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const GRID_HEIGHT = 24 * HOUR_HEIGHT_PX;

type DragState =
  | {
      type: "create";
      day: CivilDate;
      originMin: number;
      startMin: number;
      endMin: number;
    }
  | {
      type: "move";
      event: CalendarInstanceDTO;
      day: CivilDate;
      originDay: CivilDate;
      pointerOrigin: number;
      originalStart: number;
      originalEnd: number;
      startMin: number;
      endMin: number;
    }
  | {
      type: "resize";
      event: CalendarInstanceDTO;
      day: CivilDate;
      originDay: CivilDate;
      originalStart: number;
      originalEnd: number;
      startMin: number;
      endMin: number;
    };

export function TimeGrid({
  days,
  instances,
  timezone,
  availability,
  showDayHeader,
  canCreate,
  onSelectSlot,
  onEventClick,
  onTimedCommit,
}: {
  days: CivilDate[];
  instances: CalendarInstanceDTO[];
  timezone: string;
  availability: CalendarAvailability;
  showDayHeader: boolean;
  canCreate: boolean;
  onSelectSlot: (slot: SlotSelection) => void;
  onEventClick: (event: CalendarInstanceDTO) => void;
  onTimedCommit: (
    event: CalendarInstanceDTO,
    startAt: Date,
    endAt: Date,
  ) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    // A little above 07:00 so its hour label is not clipped.
    if (node) node.scrollTop = VISIBLE_HOUR_START * HOUR_HEIGHT_PX - 12;
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const today = useMemo(() => civilFromZoned(now, timezone), [now, timezone]);

  function minutesAt(target: HTMLElement, clientY: number): number {
    const rect = target.getBoundingClientRect();
    return snapMinutes(minutesFromPx(clientY - rect.top));
  }

  function finishDrag(next: DragState) {
    if (next.type === "create") {
      const startMin = Math.min(next.startMin, next.endMin);
      const endMin = Math.max(next.startMin, next.endMin);
      onSelectSlot({
        date: formatDateParam(next.day),
        startMin,
        endMin: Math.max(endMin, startMin + 30),
        allDay: false,
      });
      return;
    }
    if (next.event.isReadOnly) return;
    if (
      !timedPlacementChanged({
        originalDay: formatDateParam(next.originDay),
        currentDay: formatDateParam(next.day),
        originalStart: next.originalStart,
        originalEnd: next.originalEnd,
        startMin: next.startMin,
        endMin: next.endMin,
      })
    ) {
      return;
    }
    onTimedCommit(
      next.event,
      wallFromMinutes(next.day, next.startMin, timezone),
      wallFromMinutes(next.day, next.endMin, timezone),
    );
  }

  function bindDrag(start: DragState, originX: number, originY: number) {
    const isCreate = start.type === "create";
    if (isCreate) {
      setDrag(start);
    } else {
      setDrag(null);
    }
    dragRef.current = start;
    suppressClick.current = false;
    let armed = isCreate;

    function columnAt(
      clientX: number,
      fallback: CivilDate,
    ): { day: CivilDate; node: HTMLElement } | null {
      for (const day of days) {
        const node = document.querySelector<HTMLElement>(
          `[data-cal-day="${formatDateParam(day)}"]`,
        );
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        if (clientX >= rect.left && clientX < rect.right) {
          return { day, node };
        }
      }
      const node = document.querySelector<HTMLElement>(
        `[data-cal-day="${formatDateParam(fallback)}"]`,
      );
      return node ? { day: fallback, node } : null;
    }

    function onMove(event: PointerEvent) {
      const current = dragRef.current;
      if (!current) return;
      if (
        !armed &&
        !pointerPastThreshold(originX, originY, event.clientX, event.clientY)
      ) {
        return;
      }
      if (!armed) {
        armed = true;
        if (current.type !== "create") suppressClick.current = true;
      }
      const hit = columnAt(event.clientX, current.day);
      if (!hit) return;
      const minutes = minutesAt(hit.node, event.clientY);
      if (current.type === "create") {
        const startMin = Math.min(current.originMin, minutes);
        const endMin = Math.max(current.originMin, minutes);
        if (
          Math.abs(minutes - current.originMin) >= 15 ||
          formatDateParam(hit.day) !== formatDateParam(current.day)
        ) {
          suppressClick.current = true;
        }
        const next: DragState = {
          ...current,
          day: hit.day,
          startMin,
          endMin: Math.max(endMin, startMin + 15),
        };
        dragRef.current = next;
        setDrag(next);
        return;
      }
      if (current.type === "move") {
        const duration = current.originalEnd - current.originalStart;
        const startMin = Math.max(
          0,
          Math.min(
            DAY_MINUTES - 15,
            snapMinutes(
              current.originalStart + (minutes - current.pointerOrigin),
            ),
          ),
        );
        const next: DragState = {
          ...current,
          day: hit.day,
          startMin,
          endMin: Math.min(DAY_MINUTES, startMin + duration),
        };
        dragRef.current = next;
        setDrag(next);
        return;
      }
      const endMin = Math.max(current.startMin + 15, minutes);
      const next: DragState = { ...current, endMin };
      dragRef.current = next;
      setDrag(next);
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const current = dragRef.current;
      setDrag(null);
      dragRef.current = null;
      if (current?.type === "create") {
        finishDrag(current);
      } else if (current && armed) {
        const changed =
          current.type === "move" || current.type === "resize"
            ? timedPlacementChanged({
                originalDay: formatDateParam(current.originDay),
                currentDay: formatDateParam(current.day),
                originalStart: current.originalStart,
                originalEnd: current.originalEnd,
                startMin: current.startMin,
                endMin: current.endMin,
              })
            : false;
        if (changed) finishDrag(current);
        else suppressClick.current = false;
      }
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onColumnPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    day: CivilDate,
  ) {
    if (event.button !== 0 || !canCreate) return;
    const minutes = minutesAt(event.currentTarget, event.clientY);
    bindDrag(
      {
        type: "create",
        day,
        originMin: minutes,
        startMin: minutes,
        endMin: minutes + 60,
      },
      event.clientX,
      event.clientY,
    );
  }

  function onEventPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    instance: CalendarInstanceDTO,
    day: CivilDate,
    startMin: number,
    endMin: number,
  ) {
    event.stopPropagation();
    if (event.button !== 0 || instance.isReadOnly) return;
    const column = event.currentTarget.closest<HTMLElement>("[data-cal-day]");
    bindDrag(
      {
        type: "move",
        event: instance,
        day,
        originDay: day,
        pointerOrigin: column ? minutesAt(column, event.clientY) : startMin,
        originalStart: startMin,
        originalEnd: endMin,
        startMin,
        endMin,
      },
      event.clientX,
      event.clientY,
    );
  }

  function onResizePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    instance: CalendarInstanceDTO,
    day: CivilDate,
    startMin: number,
    endMin: number,
  ) {
    event.stopPropagation();
    if (event.button !== 0 || instance.isReadOnly) return;
    bindDrag(
      {
        type: "resize",
        event: instance,
        day,
        originDay: day,
        originalStart: startMin,
        originalEnd: endMin,
        startMin,
        endMin,
      },
      event.clientX,
      event.clientY,
    );
  }

  const widths = weekColumnWidths(days, today);
  const todayIndex = days.findIndex((day) => sameCivil(day, today));
  const nowMinToday =
    todayIndex === -1 ? null : nowMinutesOnDay(today, timezone, now);
  const offsets = widths.map((_, i) =>
    widths.slice(0, i).reduce((sum, w) => sum + w, 0),
  );
  const allDayBars = weekAllDayBars(instances, days, timezone);
  const allDayLanes = allDayBars.reduce(
    (max, bar) => Math.max(max, bar.lane + 1),
    0,
  );
  const draggingId = drag && drag.type !== "create" ? drag.event.eventId : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Today's raised surface, behind all three bands. Its own box with
          the same scrollbar gutter as the grid keeps it on the column. */}
      {todayIndex !== -1 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex overflow-hidden [scrollbar-gutter:stable]"
        >
          <div className="w-12 shrink-0" />
          <div className="relative min-w-0 flex-1">
            <div
              className="cal-raised absolute inset-y-0 rounded-[14px]"
              style={{
                left: `${offsets[todayIndex]}%`,
                width: `${widths[todayIndex]}%`,
              }}
            />
          </div>
        </div>
      )}

      {showDayHeader && (
        <div className="relative flex shrink-0 overflow-hidden border-b border-border [scrollbar-gutter:stable]">
          <div className="w-12 shrink-0" />
          <div className="flex min-w-0 flex-1">
            {days.map((day, i) => {
              const isToday = i === todayIndex;
              const isPast = compareCivil(day, today) < 0;
              const hours = dayWindow(availability, day);
              const open = openMinutesOnDay(
                instances,
                day,
                timezone,
                availability,
              );
              const openText = hours
                ? `${open === 0 ? "0 h" : formatDurationLabel(open)} open`
                : "Not available";
              if (isToday) {
                const count = timedEventsOnDay(instances, day, timezone).length;
                return (
                  <div
                    key={formatDateParam(day)}
                    className="flex min-w-0 items-baseline justify-between gap-2 px-4 pt-1.5 pb-3"
                    style={{ width: `${widths[i]}%` }}
                  >
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate font-serif text-[26px] font-semibold leading-tight text-primary">
                        {formatWeekdayLong(day)} {day.day}
                      </span>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
                        Today
                      </span>
                    </div>
                    <span className="shrink-0 truncate text-xs tabular-nums text-muted-foreground">
                      {openText} · {count} {count === 1 ? "event" : "events"}
                    </span>
                  </div>
                );
              }
              return (
                <div
                  key={formatDateParam(day)}
                  className={cn(
                    "min-w-0 px-2 pt-1.5 pb-3",
                    isPast && "opacity-45",
                  )}
                  style={{ width: `${widths[i]}%` }}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      {formatWeekdayShort(day)}
                    </span>
                    <span className="text-[19px] font-bold tabular-nums leading-tight">
                      {day.day}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[10.5px] tabular-nums text-muted-foreground">
                    {openText}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="relative flex max-h-28 shrink-0 overflow-y-auto border-b border-border [scrollbar-gutter:stable]">
        <div className="w-12 shrink-0" />
        <div
          className="relative min-w-0 flex-1"
          style={{ height: Math.max(allDayLanes, 1) * 21 + 8 }}
        >
          <div className="absolute inset-0 flex">
            {days.map((day, i) => (
              <div
                key={formatDateParam(day)}
                className="h-full"
                style={{ width: `${widths[i]}%` }}
                onClick={() => {
                  if (!canCreate) return;
                  onSelectSlot({
                    date: formatDateParam(day),
                    startMin: 0,
                    endMin: 24 * 60,
                    allDay: true,
                  });
                }}
              />
            ))}
          </div>
          {allDayBars.map((bar) => {
            const left = offsets[bar.startCol];
            const width =
              offsets[bar.endCol] + widths[bar.endCol] - offsets[bar.startCol];
            return (
              <EventBlock
                key={`${bar.event.eventId}:${bar.event.startAt}`}
                title={bar.label}
                color={bar.event.color}
                muted={bar.event.transparency === "free"}
                className={cn(
                  "absolute h-[18px] rounded-[4px] text-[11px]",
                  compareCivil(days[bar.endCol], today) < 0 && "opacity-45",
                )}
                style={{
                  top: 4 + bar.lane * 21,
                  left: `calc(${left}% + 4px)`,
                  width: `calc(${width}% - 8px)`,
                }}
                onClick={() => onEventClick(bar.event)}
              />
            );
          })}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
      >
        <div className="flex" style={{ height: GRID_HEIGHT }}>
          <div className="relative w-12 shrink-0">
            {HOURS.map((hour) => {
              const nearNow =
                nowMinToday != null &&
                Math.abs(pxFromMinutes(hour * 60 - nowMinToday)) < 12;
              return (
                <div
                  key={hour}
                  className={cn(
                    "absolute right-2 text-[10.5px] tabular-nums text-muted-foreground",
                    nearNow && "invisible",
                  )}
                  style={{ top: hour * HOUR_HEIGHT_PX - 7 }}
                >
                  {formatHourLabel(hour)}
                </div>
              );
            })}
            {nowMinToday != null && (
              <div
                aria-hidden
                className="absolute left-0 z-20 rounded-[5px] bg-primary px-[5px] py-px text-[10.5px] font-bold tabular-nums text-primary-foreground"
                style={{ top: pxFromMinutes(nowMinToday) - 8 }}
              >
                {formatTimeLabel(
                  Math.floor(nowMinToday / 60),
                  Math.floor(nowMinToday % 60),
                )}
              </div>
            )}
          </div>
          <div className="relative flex min-w-0 flex-1">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="pointer-events-none absolute inset-x-0 border-t border-border"
                style={{ top: hour * HOUR_HEIGHT_PX }}
              />
            ))}
            {days.map((day, i) => {
              const isToday = i === todayIndex;
              const isPast = compareCivil(day, today) < 0;
              const placed = placeTimedEvents(instances, day, timezone);
              const hours = dayWindow(availability, day);
              const nowMin = isToday ? nowMinToday : null;
              const spans = isToday
                ? openSpans(instances, day, timezone, availability, nowMin)
                : [];
              const inset = isToday ? 8 : 4;
              return (
                <div
                  key={formatDateParam(day)}
                  data-cal-day={formatDateParam(day)}
                  className="relative h-full min-w-0"
                  style={{ width: `${widths[i]}%` }}
                  onPointerDown={(event) => onColumnPointerDown(event, day)}
                >
                  {(hours
                    ? [
                        { from: 0, to: hours.startMin },
                        { from: hours.endMin, to: DAY_MINUTES },
                      ]
                    : [{ from: 0, to: DAY_MINUTES }]
                  )
                    .filter((band) => band.to > band.from)
                    .map((band) => (
                      <div
                        key={band.from}
                        aria-hidden
                        className="cal-hatch pointer-events-none absolute inset-x-0"
                        style={{
                          top: pxFromMinutes(band.from),
                          height: pxFromMinutes(band.to - band.from),
                        }}
                      />
                    ))}
                  {spans.map((span) => (
                    <FreetimeBlock
                      key={`${span.startMin}-${span.endMin}`}
                      span={span}
                      className="absolute"
                      style={{
                        top: pxFromMinutes(span.startMin) + 3,
                        height: pxFromMinutes(span.endMin - span.startMin) - 6,
                        left: inset,
                        right: inset,
                      }}
                      onSelect={
                        canCreate && span.state !== "passed"
                          ? () =>
                              onSelectSlot({
                                date: formatDateParam(day),
                                startMin:
                                  span.state === "now" && nowMin != null
                                    ? nowMin
                                    : span.startMin,
                                endMin: span.endMin,
                                allDay: false,
                              })
                          : undefined
                      }
                    />
                  ))}
                  {placed.map((row) => {
                    if (draggingId === row.eventId) return null;
                    const height = Math.max(
                      pxFromMinutes(row.endMin - row.startMin) - 2,
                      17,
                    );
                    const ended = nowMin != null && row.endMin <= nowMin;
                    const range = `${minuteLabel(row.startMin)}–${minuteLabel(row.endMin)}`;
                    return (
                      <EventBlock
                        key={`${row.eventId}:${row.startMin}`}
                        title={row.title}
                        color={row.color}
                        tinted
                        muted={row.transparency === "free"}
                        className={cn(
                          "absolute z-10",
                          isToday && "rounded-[7px]",
                          (isPast || ended) &&
                            (isPast ? "opacity-45" : "opacity-50"),
                        )}
                        style={{
                          top: pxFromMinutes(row.startMin) + 1,
                          height,
                          left: `calc(${(row.col / row.cols) * 100}% + ${row.col === 0 ? inset : 1}px)`,
                          width: `calc(${(1 / row.cols) * 100}% - ${(row.col === 0 ? inset : 1) + (row.col === row.cols - 1 ? inset : 1)}px)`,
                        }}
                        onClick={() => {
                          if (suppressClick.current) return;
                          onEventClick(row);
                        }}
                        onPointerDown={(event) =>
                          onEventPointerDown(
                            event,
                            row,
                            day,
                            row.startMin,
                            row.endMin,
                          )
                        }
                        onResizePointerDown={
                          row.isReadOnly
                            ? undefined
                            : (event) =>
                                onResizePointerDown(
                                  event,
                                  row,
                                  day,
                                  row.startMin,
                                  row.endMin,
                                )
                        }
                      >
                        {isToday ? (
                          height >= 30 ? (
                            <span className="block px-2.5 py-1">
                              <span className="block truncate text-[13px] font-semibold leading-tight">
                                {row.title}
                              </span>
                              <span className="mt-px block truncate text-[11px] tabular-nums opacity-75">
                                {row.location
                                  ? `${range} · ${row.location}`
                                  : range}
                              </span>
                            </span>
                          ) : (
                            <span className="flex items-baseline gap-2 whitespace-nowrap px-2.5 py-px text-xs leading-tight">
                              <span className="tabular-nums opacity-75">
                                {minuteLabel(row.startMin)}
                              </span>
                              <span className="truncate font-semibold">
                                {row.title}
                              </span>
                              {row.location && (
                                <span className="truncate opacity-75">
                                  {row.location}
                                </span>
                              )}
                            </span>
                          )
                        ) : (
                          <span className="block px-1.5 py-0.5 text-[10.5px] font-semibold leading-tight">
                            {row.title}
                          </span>
                        )}
                      </EventBlock>
                    );
                  })}
                  {drag &&
                    formatDateParam(drag.day) === formatDateParam(day) &&
                    drag.type !== "create" && (
                      <EventBlock
                        title={drag.event.title}
                        color={drag.event.color}
                        tinted
                        className="pointer-events-none absolute z-30 opacity-80"
                        style={{
                          top: pxFromMinutes(drag.startMin),
                          height: Math.max(
                            pxFromMinutes(drag.endMin - drag.startMin),
                            16,
                          ),
                          left: inset,
                          right: inset,
                        }}
                      />
                    )}
                  {drag &&
                    drag.type === "create" &&
                    formatDateParam(drag.day) === formatDateParam(day) && (
                      <div
                        className="pointer-events-none absolute inset-x-1 z-20 rounded-[5px] bg-primary/10"
                        style={{
                          top: pxFromMinutes(
                            Math.min(drag.startMin, drag.endMin),
                          ),
                          height: pxFromMinutes(
                            Math.max(30, Math.abs(drag.endMin - drag.startMin)),
                          ),
                        }}
                      />
                    )}
                  {nowMin != null && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-primary"
                      style={{ top: pxFromMinutes(nowMin) - 1 }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function minuteLabel(min: number): string {
  const clamped = Math.min(min, DAY_MINUTES - 1);
  return min >= DAY_MINUTES
    ? "24:00"
    : formatTimeLabel(Math.floor(clamped / 60), clamped % 60);
}

type AllDayBar = {
  event: CalendarInstanceDTO;
  label: string;
  startCol: number;
  endCol: number;
  lane: number;
};

/**
 * All-day events as bars across the week's columns, multi-day ones as one
 * bar with their weekday range ("Thu–Sun") in the label.
 */
function weekAllDayBars(
  instances: CalendarInstanceDTO[],
  days: CivilDate[],
  timezone: string,
): AllDayBar[] {
  const first = days[0];
  const last = days[days.length - 1];
  const items = instances
    .filter((row) => row.isAllDay)
    .map((event) => ({ event, range: eventInclusiveRange(event, timezone) }))
    .filter(
      ({ range }) =>
        compareCivil(range.end, first) >= 0 &&
        compareCivil(range.start, last) <= 0,
    )
    .map(({ event, range }) => {
      const startCol = Math.max(
        0,
        days.findIndex((day) => compareCivil(day, range.start) >= 0),
      );
      const lastIndex = days.findIndex(
        (day) => compareCivil(day, range.end) >= 0,
      );
      const endCol = lastIndex === -1 ? days.length - 1 : lastIndex;
      const multi = compareCivil(range.start, range.end) < 0;
      return {
        event,
        startCol,
        endCol,
        label: multi
          ? `${event.title} · ${formatWeekdayShort(range.start)}–${formatWeekdayShort(range.end)}`
          : event.title,
      };
    })
    .sort(
      (a, b) =>
        a.startCol - b.startCol ||
        b.endCol - b.startCol - (a.endCol - a.startCol) ||
        a.event.title.localeCompare(b.event.title),
    );
  const lanes = packLanes(items, Number.POSITIVE_INFINITY);
  return items.map((item, i) => ({ ...item, lane: lanes[i] ?? 0 }));
}
