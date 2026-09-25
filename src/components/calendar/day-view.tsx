"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import Link from "next/link";
import {
  agendaRows,
  openSpans,
  type AgendaRow,
  type OpenSpan,
} from "@/components/calendar/agenda-model";
import { staggerRows } from "@/components/calendar/day-model";
import {
  dayWindow,
  freetimeMinutes,
  nowMinutesOnDay,
  placeTimedEvents,
} from "@/components/calendar/grid-model";
import { headerNextUp, joinUrl } from "@/components/calendar/header-model";
import type {
  CalendarInstanceDTO,
  SlotSelection,
} from "@/components/calendar/types";
import type { CalendarAvailability } from "@/lib/calendar/availability";
import { normalizeEventHex, readableTextTone } from "@/lib/calendar/color";
import {
  BOOKABLE_GAP_MIN_MINUTES,
  VISIBLE_HOUR_END,
  VISIBLE_HOUR_START,
  formatDateParam,
  formatDurationLabel,
  formatTimeLabel,
  formatWeekdayLong,
  type CivilDate,
} from "@/lib/calendar/view-time";
import { cn } from "@/lib/utils";

const SETTINGS_HREF = "/settings?tab=calendar#available-time";
/** The now pill's row, then the hour ticks, then the ribbon. */
const TICKS_TOP = 22;
const RIBBON_TOP = 44;
const RIBBON_HEIGHT = 60;
const LABEL_ROW = 20;

function clock(min: number): string {
  if (min >= 24 * 60) return "24:00";
  return formatTimeLabel(Math.floor(min / 60), Math.floor(min % 60));
}

/**
 * The day as a timeline ribbon over the day's available window, then the
 * open time as cards (the longest remaining one offers to block it) and
 * the scheduled events as a list. Spans, longest stretch and rows all come
 * from agenda-model; the view only lays them out.
 */
export function DayView({
  anchor,
  instances,
  timezone,
  availability,
  canCreate,
  onSelectSlot,
  onEventClick,
}: {
  anchor: CivilDate;
  instances: CalendarInstanceDTO[];
  timezone: string;
  availability: CalendarAvailability;
  canCreate: boolean;
  onSelectSlot: (slot: SlotSelection) => void;
  onEventClick: (event: CalendarInstanceDTO) => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const nowMin = nowMinutesOnDay(anchor, timezone, now);
  const hours = dayWindow(availability, anchor);
  const spans = useMemo(
    () => openSpans(instances, anchor, timezone, availability, nowMin),
    [instances, anchor, timezone, availability, nowMin],
  );
  const rows = useMemo(
    () => agendaRows(instances, anchor, timezone, nowMin, availability),
    [instances, anchor, timezone, nowMin, availability],
  );
  const next = nowMin == null ? null : headerNextUp(instances, timezone, now);

  const date = formatDateParam(anchor);
  const select = canCreate
    ? (startMin: number, endMin: number, title?: string) =>
        onSelectSlot({ date, startMin, endMin, allDay: false, title })
    : undefined;
  // A span straddling now offers what is left of it.
  const claimFrom = (span: { startMin: number }) =>
    nowMin != null && nowMin > span.startMin ? nowMin : span.startMin;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 md:px-10">
      <Ribbon
        anchor={anchor}
        instances={instances}
        timezone={timezone}
        availability={availability}
        spans={spans}
        nowMin={nowMin}
        onEventClick={onEventClick}
        onSelect={select}
      />

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_430px] lg:gap-12">
        <section className="flex min-w-0 flex-col gap-3">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="font-serif text-[22px] font-semibold">Open time</h2>
            {hours && (
              <span className="text-xs tabular-nums text-muted-foreground">
                Counted {clock(hours.startMin)}–{clock(hours.endMin)} on{" "}
                {formatWeekdayLong(anchor)}s ·{" "}
                <Link
                  href={SETTINGS_HREF}
                  className="text-primary hover:underline"
                >
                  Change
                </Link>
              </span>
            )}
          </div>
          {!hours ? (
            <div className="rounded-xl border border-border px-[18px] py-3.5 text-sm text-muted-foreground">
              {formatWeekdayLong(anchor)}s are set as not available ·{" "}
              <Link
                href={SETTINGS_HREF}
                className="text-primary hover:underline"
              >
                Change
              </Link>
            </div>
          ) : spans.length === 0 ? (
            <div className="rounded-xl border border-border px-[18px] py-3.5 text-sm text-muted-foreground">
              No stretch of 2 h or more.
            </div>
          ) : (
            spans.map((span) => (
              <OpenCard
                key={`${span.startMin}-${span.endMin}`}
                span={span}
                onSelect={
                  select && span.state !== "passed"
                    ? (title?: string) =>
                        select(claimFrom(span), span.endMin, title)
                    : undefined
                }
              />
            ))
          )}
        </section>

        <Scheduled
          rows={rows}
          nowMin={nowMin}
          next={next}
          onEventClick={onEventClick}
        />
      </div>
    </div>
  );
}

function OpenCard({
  span,
  onSelect,
}: {
  span: OpenSpan;
  onSelect?: (title?: string) => void;
}) {
  const length = formatDurationLabel(span.minutes);
  const range = `${clock(span.startMin)} – ${clock(span.endMin)}`;
  const left = `${formatDurationLabel(span.remaining)} left`;

  if (span.isLongest) {
    return (
      <div className="flex flex-col gap-4 rounded-[14px] border border-dashed border-primary/60 bg-primary/10 px-[22px] pt-[22px] pb-5">
        <div className="flex flex-wrap items-baseline gap-x-[18px] gap-y-1">
          <span className="font-serif text-[52px] font-semibold leading-none tabular-nums text-primary">
            {length}
          </span>
          <span>
            <span className="block text-base font-semibold tabular-nums">
              {range}
            </span>
            <span className="mt-[3px] block text-[13px] text-muted-foreground">
              {span.state === "now" ? `Now · ${left}` : "Longest stretch today"}
            </span>
          </span>
        </div>
        {onSelect && (
          <div className="flex flex-wrap gap-2.5 text-[13px]">
            <button
              type="button"
              onClick={() => onSelect("Focus time")}
              className="rounded-[9px] bg-primary px-3.5 py-[9px] font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Block focus time
            </button>
            <button
              type="button"
              onClick={() => onSelect()}
              className="rounded-[9px] border border-border bg-card px-3.5 py-[9px] font-medium hover:bg-accent"
            >
              New event here
            </button>
          </div>
        )}
      </div>
    );
  }

  const passed = span.state === "passed";
  const body = (
    <>
      <span
        className={cn(
          "w-[76px] shrink-0 font-serif text-[26px] font-semibold tabular-nums",
          !passed && "text-primary",
        )}
      >
        {length}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold tabular-nums">
          {range}
        </span>
        {(passed || span.state === "now") && (
          <span
            className={cn(
              "mt-0.5 block text-[12.5px]",
              !passed && "text-primary",
            )}
          >
            {passed ? "Passed" : `Now · ${left}`}
          </span>
        )}
      </span>
    </>
  );
  const shape = cn(
    "flex items-center gap-[18px] rounded-xl px-[18px] py-3.5 text-left",
    passed
      ? "border border-border text-muted-foreground/70"
      : "border border-dashed border-primary/40 bg-card",
  );
  if (!onSelect) return <div className={shape}>{body}</div>;
  return (
    <button
      type="button"
      aria-label={`New event, ${length} from ${clock(span.startMin)}`}
      onClick={() => onSelect()}
      className={cn(
        shape,
        "hover:border-primary/60 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      {body}
    </button>
  );
}

function Ribbon({
  anchor,
  instances,
  timezone,
  availability,
  spans,
  nowMin,
  onEventClick,
  onSelect,
}: {
  anchor: CivilDate;
  instances: CalendarInstanceDTO[];
  timezone: string;
  availability: CalendarAvailability;
  spans: OpenSpan[];
  nowMin: number | null;
  onEventClick: (event: CalendarInstanceDTO) => void;
  onSelect?: (startMin: number, endMin: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(node.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The ribbon spans the day's window; a day that is off falls back to
  // the grid's visible hours so its events still have somewhere to sit.
  const hours = dayWindow(availability, anchor) ?? {
    startMin: VISIBLE_HOUR_START * 60,
    endMin: VISIBLE_HOUR_END * 60,
  };
  const length = hours.endMin - hours.startMin;
  const x = (min: number) =>
    ((Math.min(Math.max(min, hours.startMin), hours.endMin) - hours.startMin) /
      length) *
    width;

  const events = placeTimedEvents(instances, anchor, timezone).filter(
    (row) => row.endMin > hours.startMin && row.startMin < hours.endMin,
  );
  // Labels start under their event but never run past the ribbon's end.
  const labels = events.map((row) => {
    const labelWidth = Math.min(180, 44 + row.title.length * 6.6);
    return {
      x: Math.max(0, Math.min(x(row.startMin) + 1, width - labelWidth)),
      width: labelWidth,
    };
  });
  const labelRows = staggerRows(labels);
  const rowCount = events.length ? Math.max(...labelRows) + 1 : 0;

  const hourPx = (60 / length) * width;
  const step = Math.max(1, Math.ceil(44 / Math.max(hourPx, 1)));
  const ticks: number[] = [];
  for (
    let h = Math.ceil(hours.startMin / 60);
    h * 60 <= hours.endMin;
    h += step
  ) {
    ticks.push(h * 60);
  }

  function onRibbonClick(event: MouseEvent<HTMLDivElement>) {
    if (!onSelect || width === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const min = hours.startMin + ((event.clientX - rect.left) / width) * length;
    // Inside a hole: offer the hole (what is left of it on today).
    const hole = freetimeMinutes(
      instances,
      anchor,
      timezone,
      availability,
      BOOKABLE_GAP_MIN_MINUTES,
    ).find((h) => h.startMin <= min && min < h.endMin);
    if (hole) {
      const start =
        nowMin != null && nowMin > hole.startMin ? nowMin : hole.startMin;
      onSelect(start, hole.endMin);
      return;
    }
    const start = Math.floor(min / 30) * 30;
    onSelect(start, start + 60);
  }

  const height =
    RIBBON_TOP + RIBBON_HEIGHT + (rowCount ? 12 + rowCount * LABEL_ROW : 12);

  return (
    <div ref={ref} className="relative mt-3" style={{ height }}>
      {width > 0 && (
        <>
          {ticks.map((min) => (
            <span
              key={min}
              className={cn(
                "absolute w-10 -translate-x-1/2 text-center text-[10.5px] tabular-nums text-muted-foreground",
                nowMin != null &&
                  Math.abs(x(min) - x(nowMin)) < 22 &&
                  "invisible",
              )}
              style={{ left: x(min), top: TICKS_TOP }}
            >
              {clock(min)}
            </span>
          ))}
          <div
            className={cn(
              "cal-raised absolute inset-x-0 rounded-xl",
              onSelect && "cursor-copy",
            )}
            style={{ top: RIBBON_TOP, height: RIBBON_HEIGHT }}
            onClick={onRibbonClick}
          />
          {spans.map((span) => (
            <button
              key={`${span.startMin}-${span.endMin}`}
              type="button"
              disabled={!onSelect || span.state === "passed"}
              onClick={() =>
                onSelect?.(
                  nowMin != null && nowMin > span.startMin
                    ? nowMin
                    : span.startMin,
                  span.endMin,
                )
              }
              className={cn(
                "absolute flex items-center justify-center overflow-hidden whitespace-nowrap rounded-xl border border-dashed text-sm font-semibold tabular-nums text-primary disabled:cursor-default",
                span.isLongest
                  ? "border-primary/55 bg-primary/15"
                  : "border-primary/30 bg-primary/6",
              )}
              style={{
                top: RIBBON_TOP,
                height: RIBBON_HEIGHT,
                left: x(span.startMin) + 2,
                width: Math.max(0, x(span.endMin) - x(span.startMin) - 4),
              }}
            >
              {formatDurationLabel(span.minutes)}
              {span.isLongest && " · longest today"}
            </button>
          ))}
          {events.map((row, i) => {
            const left = x(row.startMin);
            const labelTop =
              RIBBON_TOP + RIBBON_HEIGHT + 10 + labelRows[i] * LABEL_ROW;
            return (
              <div key={`${row.eventId}:${row.startMin}`}>
                <button
                  type="button"
                  aria-label={`${row.title}, ${clock(row.startMin)}`}
                  onClick={() => onEventClick(row)}
                  className={cn(
                    "absolute rounded-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                    row.transparency === "free" && "opacity-50",
                  )}
                  style={{
                    top: RIBBON_TOP,
                    height: RIBBON_HEIGHT,
                    left: left + 1,
                    width: Math.max(3, x(row.endMin) - left - 2),
                    backgroundColor: normalizeEventHex(row.color),
                  }}
                />
                <span
                  aria-hidden
                  className="absolute w-px bg-border"
                  style={{
                    left: left + 1,
                    top: RIBBON_TOP + RIBBON_HEIGHT,
                    height: labelTop - RIBBON_TOP - RIBBON_HEIGHT + 2,
                  }}
                />
                <button
                  type="button"
                  onClick={() => onEventClick(row)}
                  className="absolute max-w-[180px] truncate text-left text-xs text-foreground/85 hover:text-foreground"
                  style={{
                    left: labels[i].x,
                    top: labelTop,
                    maxWidth: Math.min(180, width - labels[i].x),
                  }}
                >
                  <span className="mr-1.5 tabular-nums text-muted-foreground">
                    {clock(row.startMin)}
                  </span>
                  {row.title}
                </button>
              </div>
            );
          })}
          {nowMin != null && nowMin > hours.startMin && (
            <>
              <div
                aria-hidden
                className="pointer-events-none absolute rounded-l-xl bg-muted/60 dark:bg-background/60"
                style={{
                  top: RIBBON_TOP,
                  height: RIBBON_HEIGHT,
                  left: 0,
                  width: x(nowMin),
                }}
              />
              {nowMin < hours.endMin && (
                <>
                  <div
                    aria-hidden
                    className="pointer-events-none absolute w-0.5 rounded-[1px] bg-primary"
                    style={{
                      left: x(nowMin) - 1,
                      top: TICKS_TOP - 2,
                      height: RIBBON_TOP - TICKS_TOP + RIBBON_HEIGHT + 10,
                    }}
                  />
                  <span
                    className="pointer-events-none absolute -translate-x-1/2 rounded-[5px] bg-primary px-[5px] py-px text-[10.5px] font-bold tabular-nums text-primary-foreground"
                    style={{ left: x(nowMin), top: 0 }}
                  >
                    {clock(nowMin)}
                  </span>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Scheduled({
  rows,
  nowMin,
  next,
  onEventClick,
}: {
  rows: AgendaRow[];
  nowMin: number | null;
  next: ReturnType<typeof headerNextUp>;
  onEventClick: (event: CalendarInstanceDTO) => void;
}) {
  const events = rows.flatMap((row) => (row.kind === "event" ? [row] : []));
  const allDay = events.filter((row) => row.timeLabel == null);
  const timed = events.filter((row) => row.timeLabel != null);

  function open(event: CalendarInstanceDTO) {
    return {
      role: "button" as const,
      tabIndex: 0,
      onClick: () => onEventClick(event),
      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEventClick(event);
        }
      },
    };
  }

  return (
    <section className="cal-raised flex flex-col rounded-[14px] px-[22px] pt-5 pb-2">
      <h2 className="mb-3 font-serif text-[22px] font-semibold">Scheduled</h2>
      {allDay.length > 0 && (
        <div className="flex flex-col gap-1.5 border-b border-border pb-3.5">
          {allDay.map((row, i) => {
            const fill = normalizeEventHex(row.instance.color);
            return (
              <div key={row.id} className="flex items-center gap-2 text-[13px]">
                <span className="w-14 shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {i === 0 ? "All day" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => onEventClick(row.instance)}
                  className={cn(
                    "min-w-0 truncate rounded-[5px] px-[9px] py-[3px] text-left font-semibold",
                    readableTextTone(fill) === "light"
                      ? "text-white"
                      : "text-zinc-950",
                  )}
                  style={{ backgroundColor: fill }}
                >
                  {row.instance.title}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {timed.length === 0 && (
        <p className="py-3.5 text-sm text-muted-foreground">
          Nothing scheduled.
        </p>
      )}
      {timed.map((row, i) => {
        const ended = nowMin != null && row.endMin <= nowMin;
        const url = joinUrl(row.instance);
        const isNext =
          next != null &&
          next.instance.eventId === row.instance.eventId &&
          next.instance.startAt === row.instance.startAt;
        const detail = [row.instance.location, isNext ? next.when : null]
          .filter(Boolean)
          .join(" · ");
        return (
          <div
            key={row.id}
            {...open(row.instance)}
            className={cn(
              "flex cursor-pointer items-start gap-3.5 py-3.5 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
              i < timed.length - 1 && "border-b border-border",
              ended && "opacity-50",
            )}
          >
            <div className="w-14 shrink-0 text-[13px] font-semibold tabular-nums">
              {row.timeLabel}
              <div className="text-[11px] font-normal text-muted-foreground">
                {row.durationLabel}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{row.instance.title}</div>
              {detail && (
                <div className="mt-[3px] truncate text-xs text-muted-foreground">
                  {detail}
                </div>
              )}
            </div>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-semibold hover:bg-accent"
              >
                Join
              </a>
            )}
          </div>
        );
      })}
    </section>
  );
}
