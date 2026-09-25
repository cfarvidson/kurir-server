"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { UpNext } from "@/components/calendar/header-model";
import type {
  CalendarInstanceDTO,
  CalendarViewMode,
} from "@/components/calendar/types";
import { formatDurationLabel } from "@/lib/calendar/view-time";
import { cn } from "@/lib/utils";

const MODES: { mode: CalendarViewMode; label: string }[] = [
  { mode: "day", label: "Day" },
  { mode: "week", label: "Week" },
  { mode: "month", label: "Month" },
];

const UNIT: Record<CalendarViewMode, string> = {
  day: "day",
  week: "week",
  month: "month",
};

/**
 * The calendar's masthead: eyebrow, serif title and the open-time meta
 * line on the left; view switch, paging, Calendars and New event on the
 * right, with the Up next card under them.
 */
export function CalendarHeader({
  mode,
  eyebrow,
  title,
  calendarCount,
  openMeta,
  freeUntilLabel,
  upNext,
  canCreate,
  hrefFor,
  onPrev,
  onToday,
  onNext,
  onCalendars,
  onNewEvent,
  onOpenEvent,
}: {
  mode: CalendarViewMode;
  eyebrow: string;
  title: string;
  /** Null while the account has no calendars; the meta line is left out. */
  calendarCount: number | null;
  openMeta: string;
  freeUntilLabel: string | null;
  upNext: UpNext | null;
  canCreate: boolean;
  hrefFor: (mode: CalendarViewMode) => string;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  onCalendars: () => void;
  onNewEvent: () => void;
  onOpenEvent: (event: CalendarInstanceDTO) => void;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-x-8 gap-y-3 px-4 pt-5 pb-4 md:px-10 md:pt-7">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="truncate font-serif text-[28px] font-semibold leading-[1.05] md:text-[34px]">
          {title}
        </h1>
        {calendarCount != null && (
          <p className="text-sm tabular-nums text-muted-foreground">
            {calendarCount} {calendarCount === 1 ? "calendar" : "calendars"} ·{" "}
            <span className="font-semibold text-primary">{openMeta}</span>
            {freeUntilLabel && <> · {freeUntilLabel}</>}
          </p>
        )}
      </div>

      <div className="flex w-full flex-col gap-3 md:w-auto md:items-end">
        <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
          <nav
            aria-label="View"
            className="flex rounded-[9px] bg-border p-[3px] dark:bg-card dark:ring-1 dark:ring-border"
          >
            {MODES.map(({ mode: item, label }) => (
              <Link
                key={item}
                href={hrefFor(item)}
                aria-current={mode === item ? "page" : undefined}
                className={cn(
                  "rounded-[7px] px-3 py-[5px] transition-colors",
                  mode === item
                    ? "bg-card font-semibold text-foreground shadow-[0_1px_2px_rgba(28,23,20,0.12)] dark:bg-secondary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center">
            <button
              type="button"
              aria-label={`Previous ${UNIT[mode]}`}
              onClick={onPrev}
              className="flex size-[30px] items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={onToday}
              className="rounded-lg px-2 py-[5px] hover:bg-foreground/5"
            >
              Today
            </button>
            <button
              type="button"
              aria-label={`Next ${UNIT[mode]}`}
              onClick={onNext}
              className="flex size-[30px] items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            >
              <ChevronRight className="size-3.5" strokeWidth={2} />
            </button>
          </div>
          <button
            type="button"
            onClick={onCalendars}
            className="rounded-lg px-2 py-[5px] hover:bg-foreground/5"
          >
            Calendars
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={onNewEvent}
            className="rounded-[9px] bg-primary px-3.5 py-2 font-semibold text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            New event
          </button>
        </div>

        {upNext && <UpNextCard next={upNext} onOpen={onOpenEvent} />}
      </div>
    </header>
  );
}

function UpNextCard({
  next,
  onOpen,
}: {
  next: UpNext;
  onOpen: (event: CalendarInstanceDTO) => void;
}) {
  const place = next.instance.location;
  return (
    <div className="flex w-full items-center gap-3.5 rounded-xl border border-border bg-card py-2.5 pr-3 pl-4 shadow-[0_1px_3px_rgba(28,23,20,0.06)] md:w-[420px]">
      <button
        type="button"
        onClick={() => onOpen(next.instance)}
        className="min-w-0 flex-1 text-left focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-primary">
          Up next · in {formatDurationLabel(next.minutesUntil)}
        </span>
        <span className="mt-0.5 block truncate text-sm font-semibold">
          {next.instance.title}
        </span>
        <span className="mt-px block truncate text-xs tabular-nums text-muted-foreground">
          {place ? `${next.range} · ${place}` : next.range}
        </span>
      </button>
      {next.joinUrl && (
        <a
          href={next.joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg bg-foreground px-3.5 py-2 text-[12.5px] font-semibold text-background hover:bg-foreground/85"
        >
          Join
        </a>
      )}
    </div>
  );
}
