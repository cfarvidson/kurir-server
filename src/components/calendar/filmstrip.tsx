"use client";

import { useEffect, useMemo, useState } from "react";
import { FreetimeBlock } from "@/components/calendar/freetime-block";
import { EventBlock } from "@/components/calendar/event-block";
import {
  buildFilmstrip,
  type FilmstripDay,
  type FilmstripItem,
} from "@/components/calendar/filmstrip-model";
import type {
  CalendarInstanceDTO,
  SlotSelection,
} from "@/components/calendar/types";
import { eventBlockStyle } from "@/lib/calendar/color";
import {
  addDays,
  formatDateParam,
  formatWeekdayShort,
  type CivilDate,
} from "@/lib/calendar/view-time";
import { cn } from "@/lib/utils";

const WINDOW_BACK = 3;
const WINDOW_FORWARD = 12; // exclusive end offset

function daySpan(start: CivilDate, endExclusive: CivilDate): CivilDate[] {
  const out: CivilDate[] = [];
  let cursor = start;
  while (formatDateParam(cursor) !== formatDateParam(endExclusive)) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

function NowLine({ label }: { label: string }) {
  return (
    <div aria-hidden className="relative z-10 h-px bg-primary">
      <span className="absolute -left-0.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary" />
      <span className="absolute -top-2 left-2 text-[10px] tabular-nums text-primary">
        {label}
      </span>
    </div>
  );
}

export function Filmstrip({
  anchor,
  instances,
  timezone,
  canCreate,
  onSelectSlot,
  onEventClick,
}: {
  anchor: CivilDate;
  instances: CalendarInstanceDTO[];
  timezone: string;
  canCreate: boolean;
  onSelectSlot: (slot: SlotSelection) => void;
  onEventClick: (event: CalendarInstanceDTO) => void;
  onVisibleDayChange?: (day: CivilDate) => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const days = useMemo(
    () =>
      daySpan(addDays(anchor, -WINDOW_BACK), addDays(anchor, WINDOW_FORWARD)),
    [anchor],
  );
  const model = useMemo(
    () => buildFilmstrip(instances, days, timezone, now),
    [instances, days, timezone, now],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 pb-16">
        {model.map((day) => (
          <FilmstripDaySection
            key={day.key}
            day={day}
            canCreate={canCreate}
            onSelectSlot={onSelectSlot}
            onEventClick={onEventClick}
          />
        ))}
      </div>
    </div>
  );
}

function FilmstripDaySection({
  day,
  canCreate,
  onSelectSlot,
  onEventClick,
}: {
  day: FilmstripDay;
  canCreate: boolean;
  onSelectSlot: (slot: SlotSelection) => void;
  onEventClick: (event: CalendarInstanceDTO) => void;
}) {
  const hasEvents =
    day.allDay.length > 0 || day.items.some((i) => i.kind === "event");

  function renderItem(item: FilmstripItem, index: number) {
    const between =
      day.now?.kind === "between" && day.now.beforeIndex === index;
    const inside = day.now?.kind === "in-item" && day.now.index === index;
    return (
      <div key={index} className="relative">
        {between && <NowLine label={day.nowTimeLabel ?? ""} />}
        {item.kind === "event" && (
          <button
            type="button"
            onClick={() => onEventClick(item.instance)}
            className="flex w-full items-baseline gap-3 rounded-xs px-3 py-2 text-left focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            style={{
              minHeight: item.heightPx,
              ...eventBlockStyle(item.instance.color),
              borderLeft: "2px solid var(--event-color)",
              backgroundColor: "var(--event-fill)",
            }}
          >
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {item.startLabel}
            </span>
            <span className="min-w-0 truncate text-sm font-semibold">
              {item.instance.title}
            </span>
            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
              {item.durationLabel}
            </span>
          </button>
        )}
        {item.kind === "freetime" && (
          <FreetimeBlock
            minutes={item.minutes}
            className="flex flex-col"
            style={{ height: item.heightPx }}
            onSelect={
              canCreate
                ? () =>
                    onSelectSlot({
                      date: day.key,
                      startMin: item.startMin,
                      endMin: item.endMin,
                      allDay: false,
                    })
                : undefined
            }
          />
        )}
        {item.kind === "seam" && (
          <div aria-hidden className="my-3 border-t border-dashed border-border" />
        )}
        {inside && item.kind !== "seam" && (
          <div
            className="pointer-events-none absolute inset-x-0"
            style={{
              top: `${(day.now as { fraction: number }).fraction * 100}%`,
            }}
          >
            <NowLine label={day.nowTimeLabel ?? ""} />
          </div>
        )}
      </div>
    );
  }

  return (
    <section
      data-filmstrip-day={day.key}
      className={cn("pt-6", day.isPast && "opacity-60")}
    >
      <header className="flex items-baseline gap-2 pb-2">
        <span
          className={cn(
            "font-serif text-2xl font-semibold tabular-nums",
            day.isToday && "text-primary",
          )}
        >
          {day.date.day}
        </span>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {formatWeekdayShort(day.date)}
        </span>
      </header>
      {day.allDay.map((row) => (
        <EventBlock
          key={`${row.eventId}:${row.startAt}`}
          title={row.title}
          color={row.color}
          muted={row.transparency === "free"}
          className="relative mb-1 h-5"
          onClick={() => onEventClick(row)}
        />
      ))}
      {hasEvents ? (
        day.items.map(renderItem)
      ) : (
        <button
          type="button"
          disabled={!canCreate}
          onClick={() =>
            onSelectSlot({
              date: day.key,
              startMin: 9 * 60,
              endMin: 10 * 60,
              allDay: false,
            })
          }
          className="w-full rounded-xs px-3 py-4 text-left text-sm text-muted-foreground hover:text-foreground disabled:pointer-events-none"
        >
          Nothing planned
        </button>
      )}
      {!hasEvents && (
        <div aria-hidden className="my-3 border-t border-dashed border-border" />
      )}
    </section>
  );
}
