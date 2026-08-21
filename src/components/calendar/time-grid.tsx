"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { EventBlock } from "@/components/calendar/event-block";
import { FreetimeBlock } from "@/components/calendar/freetime-block";
import {
  allDayEventsOnDay,
  freetimeMinutes,
  minutesFromPx,
  nowMinutesOnDay,
  placeTimedEvents,
  pxFromMinutes,
  snapMinutes,
  wallFromMinutes,
} from "@/components/calendar/grid-model";
import {
  pointerPastThreshold,
  timedPlacementChanged,
} from "@/components/calendar/timed-drag";
import type {
  CalendarInstanceDTO,
  SlotSelection,
} from "@/components/calendar/types";
import {
  DAY_MINUTES,
  HOUR_HEIGHT_PX,
  VISIBLE_HOUR_START,
  civilFromZoned,
  formatDateParam,
  formatHourLabel,
  formatTimeLabel,
  formatWeekdayShort,
  isWeekend,
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
  showDayHeader,
  canCreate,
  onSelectSlot,
  onEventClick,
  onTimedCommit,
}: {
  days: CivilDate[];
  instances: CalendarInstanceDTO[];
  timezone: string;
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
    if (node) node.scrollTop = VISIBLE_HOUR_START * HOUR_HEIGHT_PX;
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
    const originalStart =
      next.type === "move" || next.type === "resize"
        ? next.originalStart
        : next.startMin;
    const originalEnd =
      next.type === "move" || next.type === "resize"
        ? next.originalEnd
        : next.endMin;
    const originalDay =
      next.type === "move" || next.type === "resize" ? next.originDay : next.day;
    if (
      !timedPlacementChanged({
        originalDay: formatDateParam(originalDay),
        currentDay: formatDateParam(next.day),
        originalStart,
        originalEnd,
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showDayHeader && (
        <div className="flex shrink-0 border-b border-border">
          <div className="w-14 shrink-0" />
          {days.map((day) => (
            <div
              key={formatDateParam(day)}
              className={cn(
                "min-w-0 flex-1 py-2 text-center",
                isWeekend(day) && "bg-muted/40",
                sameCivil(day, today) && "bg-primary/5",
              )}
            >
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {formatWeekdayShort(day)}
              </div>
              <div
                className={cn(
                  "text-sm font-medium tabular-nums",
                  sameCivil(day, today) && "text-primary",
                )}
              >
                {day.day}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex max-h-28 shrink-0 overflow-y-auto border-b border-border">
        <div className="w-14 shrink-0" />
        {days.map((day) => {
          const allDay = allDayEventsOnDay(instances, day, timezone);
          return (
            <div
              key={formatDateParam(day)}
              className={cn(
                "min-w-0 flex-1 space-y-0.5 p-0.5",
                isWeekend(day) && "bg-muted/40",
                sameCivil(day, today) && "bg-primary/5",
              )}
              onClick={() => {
                if (!canCreate) return;
                onSelectSlot({
                  date: formatDateParam(day),
                  startMin: 0,
                  endMin: 24 * 60,
                  allDay: true,
                });
              }}
            >
              {allDay.map((row) => (
                <EventBlock
                  key={`${row.eventId}:${row.startAt}`}
                  title={row.title}
                  color={row.color}
                  muted={row.transparency === "free"}
                  className="relative h-5"
                  onClick={() => onEventClick(row)}
                />
              ))}
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div className="flex" style={{ height: GRID_HEIGHT }}>
          <div className="relative w-14 shrink-0">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute right-2 text-[11px] tabular-nums text-muted-foreground"
                style={{ top: hour * HOUR_HEIGHT_PX - 7 }}
              >
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>
          {days.map((day) => {
            const placed = placeTimedEvents(instances, day, timezone);
            const gaps = freetimeMinutes(instances, day, timezone);
            const nowMin = nowMinutesOnDay(day, timezone, now);
            const draggingId =
              drag && drag.type !== "create" ? drag.event.eventId : null;
            return (
              <div
                key={formatDateParam(day)}
                data-cal-day={formatDateParam(day)}
                className={cn(
                  "relative min-w-0 flex-1 border-l border-border",
                  isWeekend(day) && "bg-muted/40",
                  sameCivil(day, today) && "bg-primary/5",
                )}
                onPointerDown={(event) => onColumnPointerDown(event, day)}
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="pointer-events-none absolute inset-x-0 border-t border-border"
                    style={{ top: hour * HOUR_HEIGHT_PX }}
                  />
                ))}
                {gaps.map((gap) => (
                  <FreetimeBlock
                    key={`${gap.startMin}-${gap.endMin}`}
                    minutes={gap.endMin - gap.startMin}
                    className="absolute inset-x-0"
                    style={{
                      top: pxFromMinutes(gap.startMin),
                      height: pxFromMinutes(gap.endMin - gap.startMin),
                    }}
                    onSelect={
                      canCreate
                        ? () =>
                            onSelectSlot({
                              date: formatDateParam(day),
                              startMin: gap.startMin,
                              endMin: gap.endMin,
                              allDay: false,
                            })
                        : undefined
                    }
                  />
                ))}
                {placed.map((row) => {
                  if (draggingId === row.eventId) return null;
                  return (
                    <EventBlock
                      key={`${row.eventId}:${row.startMin}`}
                      title={row.title}
                      color={row.color}
                      timeLabel={
                        row.endMin - row.startMin >= 45
                          ? formatTimeLabel(Math.floor(row.startMin / 60), row.startMin % 60)
                          : undefined
                      }
                      muted={row.transparency === "free"}
                      className="absolute z-10"
                      style={{
                        top: pxFromMinutes(row.startMin),
                        height: Math.max(pxFromMinutes(row.endMin - row.startMin), 16),
                        left: `calc(${(row.col / row.cols) * 100}% + 1px)`,
                        width: `calc(${(1 / row.cols) * 100}% - 2px)`,
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
                    />
                  );
                })}
                {drag &&
                  formatDateParam(drag.day) === formatDateParam(day) &&
                  drag.type !== "create" && (
                    <EventBlock
                      title={drag.event.title}
                      color={drag.event.color}
                      className="pointer-events-none absolute z-30 opacity-80"
                      style={{
                        top: pxFromMinutes(drag.startMin),
                        height: Math.max(
                          pxFromMinutes(drag.endMin - drag.startMin),
                          16,
                        ),
                        left: "1px",
                        width: "calc(100% - 2px)",
                      }}
                    />
                  )}
                {drag &&
                  drag.type === "create" &&
                  formatDateParam(drag.day) === formatDateParam(day) && (
                    <div
                      className="pointer-events-none absolute inset-x-1 z-20 rounded-xs bg-primary/10"
                      style={{
                        top: pxFromMinutes(Math.min(drag.startMin, drag.endMin)),
                        height: pxFromMinutes(
                          Math.max(30, Math.abs(drag.endMin - drag.startMin)),
                        ),
                      }}
                    />
                  )}
                {nowMin != null && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-20 h-px bg-primary"
                    style={{ top: pxFromMinutes(nowMin) }}
                  >
                    <span
                      aria-hidden
                      className="absolute -left-0.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary"
                    />
                    <span className="absolute -top-2 left-1 text-[10px] tabular-nums text-primary">
                      {formatTimeLabel(
                        Math.floor(nowMin / 60),
                        Math.floor(nowMin % 60),
                      )}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
