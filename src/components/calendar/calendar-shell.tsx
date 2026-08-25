"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CalendarEmpty } from "@/components/calendar/calendar-empty";
import { CalendarList } from "@/components/calendar/calendar-list";
import { DayView } from "@/components/calendar/day-view";
import { EventDialog, RecurrenceRangeDialog } from "@/components/calendar/event-dialog";
import { MonthView } from "@/components/calendar/month-view";
import { WeekView } from "@/components/calendar/week-view";
import type {
  CalendarInstanceDTO,
  CalendarViewMode,
  SlotSelection,
} from "@/components/calendar/types";
import { PageMasthead } from "@/components/layout/page-masthead";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { updateEventAction } from "@/actions/calendar";
import type { CalendarPagePayload } from "@/lib/calendar/page-data";
import { keyboardState } from "@/lib/keyboard-state";
import type { RecurrenceEdit } from "@/lib/calendar/providers/types";
import {
  addDays,
  addMonths,
  civilFromZoned,
  formatDateParam,
  formatDayTitle,
  formatMonthTitle,
  formatWeekTitle,
  weekDays,
  zonedParts,
  type CivilDate,
} from "@/lib/calendar/view-time";
import { cn } from "@/lib/utils";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

function viewPath(mode: CalendarViewMode): string {
  if (mode === "day") return "/calendar/day";
  if (mode === "month") return "/calendar/month";
  return "/calendar";
}

function viewHref(mode: CalendarViewMode, date: string): string {
  const params = new URLSearchParams();
  params.set("date", date);
  if (mode === "week") params.set("stay", "1");
  return `${viewPath(mode)}?${params.toString()}`;
}

function defaultSlot(date: string, timezone: string): SlotSelection {
  const today = formatDateParam(civilFromZoned(new Date(), timezone));
  if (date === today) {
    const wall = zonedParts(new Date(), timezone);
    const startMin = Math.min(
      21 * 60,
      Math.ceil((wall.hour * 60 + wall.minute + 15) / 30) * 30,
    );
    return { date, startMin, endMin: startMin + 60, allDay: false };
  }
  return { date, startMin: 9 * 60, endMin: 10 * 60, allDay: false };
}

function hasWritable(payload: CalendarPagePayload): boolean {
  return payload.accounts.some((account) =>
    account.calendars.some((calendar) => !calendar.isReadOnly),
  );
}

export function CalendarShell({ payload }: { payload: CalendarPagePayload }) {
  const router = useRouter();
  const pathname = usePathname();
  const [calendarsOpen, setCalendarsOpen] = useState(false);
  const date = formatDateParam(payload.anchor);
  const [dialogOpen, setDialogOpen] = useState(
    payload.openNew && hasWritable(payload),
  );
  const [editing, setEditing] = useState<CalendarInstanceDTO | null>(null);
  const [slot, setSlot] = useState<SlotSelection | null>(() =>
    payload.openNew && hasWritable(payload)
      ? defaultSlot(date, payload.timezone)
      : null,
  );
  const [pendingMove, setPendingMove] = useState<{
    event: CalendarInstanceDTO;
    startAt: Date;
    endAt: Date;
  } | null>(null);

  const calendarCount = payload.accounts.reduce(
    (sum, account) => sum + account.calendars.length,
    0,
  );
  const writable = payload.accounts.some((account) =>
    account.calendars.some((calendar) => !calendar.isReadOnly),
  );
  const empty = payload.accounts.length === 0;
  const errors = payload.accounts.filter(
    (account) => account.oauthError || account.lastError,
  );

  const title = useMemo(() => {
    if (payload.mode === "day") return formatDayTitle(payload.anchor);
    if (payload.mode === "month") return formatMonthTitle(payload.anchor);
    return formatWeekTitle(weekDays(payload.anchor));
  }, [payload.anchor, payload.mode]);

  const todayDate = formatDateParam(
    civilFromZoned(new Date(), payload.timezone),
  );

  useLayoutEffect(() => {
    if (payload.mode !== "week") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("stay")) return;
    if (window.matchMedia("(min-width: 768px)").matches) return;
    params.delete("view");
    const qs = params.toString();
    router.replace(qs ? `/calendar/day?${qs}` : "/calendar/day");
  }, [payload.mode, router]);

  useEffect(() => {
    if (!payload.openNew) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("new")) return;
    params.delete("new");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [payload.openNew, pathname, router]);

  const openCreate = useCallback(
    (next: SlotSelection) => {
      if (!writable) return;
      setEditing(null);
      setSlot(next);
      setDialogOpen(true);
    },
    [writable],
  );

  const openEvent = useCallback((event: CalendarInstanceDTO) => {
    setSlot(null);
    setEditing(event);
    setDialogOpen(true);
  }, []);

  const goToKey = useCallback(
    (key: string) => {
      router.push(viewHref(payload.mode, key));
    },
    [payload.mode, router],
  );

  const goTo = useCallback(
    (next: CivilDate) => goToKey(formatDateParam(next)),
    [goToKey],
  );

  const goToday = useCallback(() => goToKey(todayDate), [goToKey, todayDate]);

  const goPrev = useCallback(() => {
    if (payload.mode === "month") goTo(addMonths(payload.anchor, -1));
    else if (payload.mode === "week") goTo(addDays(payload.anchor, -7));
    else goTo(addDays(payload.anchor, -1));
  }, [goTo, payload.anchor, payload.mode]);

  const goNext = useCallback(() => {
    if (payload.mode === "month") goTo(addMonths(payload.anchor, 1));
    else if (payload.mode === "week") goTo(addDays(payload.anchor, 7));
    else goTo(addDays(payload.anchor, 1));
  }, [goTo, payload.anchor, payload.mode]);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if (!pathname.startsWith("/calendar")) return;
      if (isTypingTarget(event.target)) return;
      if (keyboardState.gSequenceActive || keyboardState.popoverOpen) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (dialogOpen || pendingMove) return;
      if (document.querySelector('[role="dialog"]')) return;

      if (event.key === "n") {
        event.preventDefault();
        openCreate(defaultSlot(date, payload.timezone));
        return;
      }
      if (event.key === "t") {
        event.preventDefault();
        goToday();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    pathname,
    dialogOpen,
    pendingMove,
    date,
    payload.timezone,
    openCreate,
    goToday,
    goPrev,
    goNext,
  ]);

  async function applyMove(
    event: CalendarInstanceDTO,
    startAt: Date,
    endAt: Date,
    range: RecurrenceEdit,
  ) {
    try {
      await updateEventAction(
        event.eventId,
        {
          title: event.title,
          description: event.description,
          location: event.location,
          startAt,
          endAt,
          isAllDay: event.isAllDay,
          timezone: event.isAllDay ? null : payload.timezone,
          rrule: event.rrule,
          calendarId: event.calendarId,
        },
        range,
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not move event");
    }
  }

  function handleTimedCommit(
    event: CalendarInstanceDTO,
    startAt: Date,
    endAt: Date,
  ) {
    if (event.rrule) {
      setPendingMove({ event, startAt, endAt });
      return;
    }
    void applyMove(event, startAt, endAt, "all");
  }

  const viewProps = {
    anchor: payload.anchor,
    instances: payload.instances,
    timezone: payload.timezone,
    canCreate: writable,
    onSelectSlot: openCreate,
    onEventClick: openEvent,
    onTimedCommit: handleTimedCommit,
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageMasthead
        eyebrow="Calendar"
        title={title}
        meta={
          empty
            ? undefined
            : `${calendarCount} ${calendarCount === 1 ? "calendar" : "calendars"}`
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCalendarsOpen(true)}
            >
              Calendars
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!writable}
              onClick={() => openCreate(defaultSlot(date, payload.timezone))}
            >
              New event
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-3 px-4 pb-3 md:px-6">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Previous"
              onClick={goPrev}
            >
              <ChevronLeft />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={goToday}>
              Today
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Next"
              onClick={goNext}
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="flex items-center gap-3">
            {(["week", "day", "month"] as const).map((mode) => (
              <Link
                key={mode}
                href={viewHref(mode, date)}
                aria-current={payload.mode === mode ? "page" : undefined}
                className={cn(
                  "border-b-2 pb-1 text-xs font-medium capitalize transition-colors",
                  payload.mode === mode
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {mode}
              </Link>
            ))}
          </div>
        </div>
      </PageMasthead>

      {errors.map((account) => (
        <div
          key={account.id}
          role="alert"
          className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200 md:px-6"
        >
          {account.displayName}: {account.oauthError || account.lastError}
        </div>
      ))}

      {empty ? (
        <CalendarEmpty />
      ) : (
        <div className="flex min-h-0 flex-1">
          {payload.mode === "month" ? (
            <MonthView
              anchor={payload.anchor}
              instances={payload.instances}
              timezone={payload.timezone}
              onEventClick={openEvent}
            />
          ) : payload.mode === "day" ? (
            <DayView
              anchor={payload.anchor}
              instances={payload.instances}
              timezone={payload.timezone}
              canCreate={writable}
              onSelectSlot={openCreate}
              onEventClick={openEvent}
            />
          ) : (
            <WeekView {...viewProps} />
          )}
        </div>
      )}

      <Dialog open={calendarsOpen} onOpenChange={setCalendarsOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Calendars</DialogTitle>
            <DialogDescription>Show or hide calendars in this view.</DialogDescription>
          </DialogHeader>
          <CalendarList accounts={payload.accounts} />
        </DialogContent>
      </Dialog>

      <EventDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        timezone={payload.timezone}
        accounts={payload.accounts}
        event={editing}
        slot={slot}
      />

      <RecurrenceRangeDialog
        open={pendingMove != null}
        onOpenChange={(open) => {
          if (!open) setPendingMove(null);
        }}
        title="Edit recurring event"
        onPick={(range) => {
          if (!pendingMove) return;
          const move = pendingMove;
          setPendingMove(null);
          void applyMove(move.event, move.startAt, move.endAt, range);
        }}
      />
    </div>
  );
}
