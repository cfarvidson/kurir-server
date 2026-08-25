"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  agendaRows,
  nowLineIndex,
  type AgendaRow,
} from "@/components/calendar/agenda-model";
import { nowMinutesOnDay } from "@/components/calendar/grid-model";
import type {
  CalendarInstanceDTO,
  SlotSelection,
} from "@/components/calendar/types";
import { normalizeEventHex, readableTextTone } from "@/lib/calendar/color";
import {
  formatDateParam,
  formatFreetimeLabel,
  formatTimeLabel,
  zonedParts,
  type CivilDate,
} from "@/lib/calendar/view-time";
import { cn } from "@/lib/utils";

const GUTTER = "w-[52px] shrink-0 text-right";

/**
 * The day as a vertical agenda: the iOS day view, ported. Free time is
 * real rows with a click target - not text in the margin - and the day's
 * longest hole names itself.
 *
 * The view computes nothing: rows come ready-made from agenda-model. If
 * you find yourself counting minutes here, something is missing in the
 * model, and that is where the fix belongs.
 */
export function DayView({
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
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // On today the rows themselves know about now: straddling free/gap
  // spans are clipped to what remains and the ongoing event is flagged.
  // Any other day gets null and renders untouched.
  const nowMin = nowMinutesOnDay(anchor, timezone, now);
  const rows = useMemo(
    () => agendaRows(instances, anchor, timezone, nowMin),
    [instances, anchor, timezone, nowMin],
  );
  // The line only appears in unbooked time; while an event is ongoing
  // its row carries the marking instead and the index is null.
  const nowAt = nowMin == null ? null : nowLineIndex(rows, nowMin);

  // Without a writable calendar the free rows still render as
  // information, just without the claim affordance.
  const selectSpan = canCreate
    ? (row: AgendaRow) =>
        onSelectSlot({
          date: formatDateParam(anchor),
          startMin: row.startMin,
          endMin: row.endMin,
          allDay: false,
        })
    : undefined;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 py-3">
        {rows.map((row, index) => (
          <Fragment key={row.id}>
            {index === nowAt && <NowLine now={now} timezone={timezone} />}
            {row.kind === "event" ? (
              <EventRow row={row} onEventClick={onEventClick} />
            ) : row.kind === "free" ? (
              <FreeRow
                row={row}
                onSelect={selectSpan && (() => selectSpan(row))}
              />
            ) : (
              <GapRow row={row} onSelect={selectSpan && (() => selectSpan(row))} />
            )}
          </Fragment>
        ))}
        {nowAt === rows.length && <NowLine now={now} timezone={timezone} />}
        <p className="pt-2 text-center font-serif text-[13px] italic text-muted-foreground">
          Time never stops.
        </p>
      </div>
    </div>
  );
}

function EventRow({
  row,
  onEventClick,
}: {
  row: AgendaRow & { kind: "event" };
  onEventClick: (event: CalendarInstanceDTO) => void;
}) {
  const fill = normalizeEventHex(row.instance.color);
  const tone = readableTextTone(fill);
  // "Work · Rum Bergman". The calendar name always stands; the location
  // only when it exists.
  const subtitle = row.instance.location
    ? `${row.instance.calendarName} · ${row.instance.location}`
    : row.instance.calendarName;
  return (
    <button
      type="button"
      onClick={() => onEventClick(row.instance)}
      className="flex min-h-11 items-start gap-2.5 text-left focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className={cn(GUTTER, "flex flex-col items-end pt-0.5")}>
        <span className="text-[13px] font-medium tabular-nums">
          {row.timeLabel ?? "All-day"}
        </span>
        {row.timeLabel != null && row.durationLabel != null && (
          <span className="text-[11px] text-muted-foreground">
            {row.durationLabel}
          </span>
        )}
        {row.isNow && (
          <span
            aria-label="Now"
            className="flex items-center gap-1 text-[11px] font-medium text-primary"
          >
            <span className="size-1.5 rounded-full bg-primary" />
            Now
          </span>
        )}
      </span>
      <span
        className={cn(
          "flex min-w-0 flex-1 flex-col rounded-md px-2.5 py-2",
          tone === "light" ? "text-white" : "text-zinc-950",
        )}
        style={{ backgroundColor: fill }}
      >
        <span className="line-clamp-2 text-[15px] font-semibold">
          {row.instance.title}
        </span>
        <span className="truncate text-xs opacity-75">{subtitle}</span>
      </span>
    </button>
  );
}

/**
 * A free span as a dashed claim capsule. The longest one promotes itself
 * with a name and a filled "+" badge.
 */
function FreeRow({
  row,
  onSelect,
}: {
  row: AgendaRow & { kind: "free" };
  onSelect?: () => void;
}) {
  const label = formatFreetimeLabel(row.minutes);
  const body = (
    <>
      <span
        className={cn(
          GUTTER,
          "pt-0.5 text-[13px] font-medium tabular-nums",
          row.isLongest ? "text-primary" : "text-muted-foreground",
        )}
      >
        {row.timeLabel}
      </span>
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 rounded-md border border-dashed px-3",
          row.isLongest
            ? "border-primary/35 bg-primary/10 py-3"
            : "border-primary/20 bg-primary/5 py-2.5",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col items-start">
          <span
            className={cn(
              "font-medium tabular-nums text-primary",
              row.isLongest ? "text-sm" : "text-[13px]",
            )}
          >
            {label}
          </span>
          {row.isLongest && (
            <span className="text-xs text-muted-foreground">
              Your longest stretch today
            </span>
          )}
        </span>
        {onSelect &&
          (row.isLongest ? (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Plus className="size-4" strokeWidth={2.5} />
            </span>
          ) : (
            <Plus className="size-4 shrink-0 text-primary/70" />
          ))}
      </span>
    </>
  );
  if (!onSelect) {
    return (
      <div
        aria-label={`${label} from ${row.timeLabel}`}
        className="flex min-h-11 items-start gap-2.5"
      >
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={`${label} from ${row.timeLabel}`}
      onClick={onSelect}
      className="flex min-h-11 items-start gap-2.5 text-left focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
    >
      {body}
    </button>
  );
}

/**
 * The hole between two meetings. Grey and capsule-less - the claim
 * capsule says "this is worth your time", and a quarter hour between two
 * meetings makes no such claim. Not drawn at all when nothing can be
 * written: a row that only looks clickable is worse than no row.
 */
function GapRow({
  row,
  onSelect,
}: {
  row: AgendaRow & { kind: "gap" };
  onSelect?: () => void;
}) {
  if (!onSelect) return null;
  return (
    <button
      type="button"
      aria-label={`New event, ${row.durationLabel} from ${row.timeLabel}`}
      onClick={onSelect}
      className="flex min-h-11 items-center gap-2.5 text-left focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className={cn(GUTTER, "text-[13px] tabular-nums text-muted-foreground/70")}>
        {row.timeLabel}
      </span>
      <span className="text-[13px] tabular-nums text-muted-foreground/70">
        {row.durationLabel}
      </span>
      <span className="flex-1" />
      <Plus className="size-3.5 text-muted-foreground/70" />
    </button>
  );
}

function NowLine({ now, timezone }: { now: Date; timezone: string }) {
  const wall = zonedParts(now, timezone);
  const label = formatTimeLabel(wall.hour, wall.minute);
  return (
    <div aria-label={`Now, ${label}`} className="flex items-center gap-2.5">
      <span
        className={cn(GUTTER, "text-[13px] font-medium tabular-nums text-primary")}
      >
        {label}
      </span>
      <span className="flex flex-1 items-center">
        <span className="size-1.5 rounded-full bg-primary" />
        <span className="h-px flex-1 bg-primary" />
      </span>
    </div>
  );
}
