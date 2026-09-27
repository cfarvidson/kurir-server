"use client";

import type { RefObject } from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
  eventRail,
  eventRepeatLine,
  eventWhenDate,
  eventWhenLine,
  noteSegments,
} from "@/components/calendar/event-view-model";
import type { CalendarInstanceDTO } from "@/components/calendar/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { normalizeEventHex } from "@/lib/calendar/color";
import type { RecurrenceEdit } from "@/lib/calendar/providers/types";
import { cn } from "@/lib/utils";

type Measurable = { getBoundingClientRect(): DOMRect };

function CalendarLabel({ event }: { event: CalendarInstanceDTO }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: normalizeEventHex(event.color) }}
      />
      <span className="eyebrow truncate text-muted-foreground">
        {event.calendarName}
      </span>
    </div>
  );
}

/** The notes with web and email addresses as links. */
function NotesText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn("whitespace-pre-wrap break-words", className)}>
      {noteSegments(text).map((segment, i) =>
        segment.href ? (
          <a
            key={i}
            href={segment.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline-offset-2 hover:underline"
          >
            {segment.text}
          </a>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

/**
 * Design D: what a click on an event shows, next to the event. Enough to
 * answer "what and when"; "Open event" has the rest, Edit has the form.
 */
export function EventPopover({
  event,
  anchor,
  timezone,
  onClose,
  onOpen,
  onEdit,
  onDelete,
}: {
  event: CalendarInstanceDTO | null;
  anchor: RefObject<Measurable | null>;
  timezone: string;
  onClose: () => void;
  onOpen: (event: CalendarInstanceDTO) => void;
  onEdit: (event: CalendarInstanceDTO) => void;
  onDelete: (event: CalendarInstanceDTO) => void;
}) {
  const meta = event
    ? [event.location || null, eventRepeatLine(event, timezone)]
        .filter(Boolean)
        .join(" · ")
    : "";
  return (
    <Popover
      open={event != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={anchor} />
      {event && (
        <PopoverContent
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={16}
          aria-label={event.title}
          className="w-[340px] rounded-[14px] p-0"
        >
          <div className="flex flex-col gap-1.5 px-5 pt-5">
            <CalendarLabel event={event} />
            <h2 className="mt-0.5 font-serif text-[22px] font-semibold leading-tight tracking-[-0.015em]">
              {event.title}
            </h2>
            <p className="text-[14px] tabular-nums">
              {eventWhenLine(event, timezone)}
            </p>
            {meta && (
              <p className="text-[13px] text-muted-foreground">{meta}</p>
            )}
          </div>
          {event.description && (
            <div className="mx-5 mt-3 border-t border-border pt-3">
              <NotesText
                text={event.description}
                className="line-clamp-4 text-[15px] leading-[1.5]"
              />
            </div>
          )}
          <div className="flex items-center gap-2 px-5 pt-4 pb-4">
            <button
              type="button"
              onClick={() => onOpen(event)}
              className="mr-auto rounded-xs text-[14px] font-medium text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            >
              Open event
            </button>
            {!event.isReadOnly && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Delete event"
                  title="Delete event"
                  className="size-8 text-red-700 dark:text-red-400"
                  onClick={() => onDelete(event)}
                >
                  <Trash2 />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 px-3.5 text-[13px]"
                  onClick={() => onEdit(event)}
                >
                  Edit
                </Button>
              </>
            )}
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="eyebrow text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/**
 * Design E: the event, read. Start and end in large serif beside When and
 * Where; the notes as the main text. Delete and Edit at the foot.
 */
export function EventViewDialog({
  event,
  timezone,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  event: CalendarInstanceDTO | null;
  timezone: string;
  onOpenChange: (open: boolean) => void;
  onEdit: (event: CalendarInstanceDTO) => void;
  onDelete: (event: CalendarInstanceDTO) => void;
}) {
  const rail = event ? eventRail(event, timezone) : null;
  const repeats = event ? eventRepeatLine(event, timezone) : null;
  return (
    <Dialog open={event != null} onOpenChange={onOpenChange}>
      {event && rail && (
        <DialogContent className="flex max-h-[90dvh] flex-col gap-0 p-0 sm:max-w-[560px] sm:rounded-[16px]">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-6 pb-6 sm:px-9 sm:pt-7">
            <div className="flex flex-col gap-2.5 pr-8">
              <CalendarLabel event={event} />
              <DialogTitle className="font-serif text-[30px] font-semibold leading-[1.1] tracking-[-0.022em] sm:text-[34px]">
                {event.title}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {eventWhenLine(event, timezone)}
              </DialogDescription>
            </div>
            <div className="mt-6 grid grid-cols-[104px_minmax(0,1fr)] gap-5 border-y border-border py-5 sm:grid-cols-[128px_minmax(0,1fr)] sm:gap-6">
              <div className="flex flex-col font-serif tabular-nums lining-nums">
                <span className="truncate text-[30px] font-medium leading-none tracking-[-0.02em] sm:text-[34px]">
                  {rail.start}
                </span>
                {rail.end && (
                  <>
                    <span
                      aria-hidden
                      className="my-[7px] ml-1 h-[22px] w-0.5 rounded-full bg-border"
                    />
                    <span className="text-[30px] font-medium leading-none tracking-[-0.02em] text-muted-foreground sm:text-[34px]">
                      {rail.end}
                    </span>
                  </>
                )}
                {rail.note && (
                  <span className="mt-2 font-sans text-[14px] text-muted-foreground">
                    {rail.note}
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                <Fact label="When">
                  <span className="text-[16px]">
                    {eventWhenDate(event, timezone)}
                  </span>
                  {repeats && (
                    <span className="text-[14px] text-muted-foreground">
                      {repeats}
                    </span>
                  )}
                </Fact>
                {event.location && (
                  <Fact label="Where">
                    <span className="break-words text-[16px]">
                      {event.location}
                    </span>
                  </Fact>
                )}
              </div>
            </div>
            {event.description && (
              <NotesText
                text={event.description}
                className="mt-6 font-serif text-[19px] leading-[1.6]"
              />
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-border px-6 py-4">
            {!event.isReadOnly && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-red-700 hover:text-red-800 dark:text-red-400"
                onClick={() => onDelete(event)}
              >
                <Trash2 />
                Delete
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className={cn(event.isReadOnly && "ml-auto")}
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            {!event.isReadOnly && (
              <Button type="button" onClick={() => onEdit(event)}>
                <Pencil />
                Edit
              </Button>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

/**
 * Delete, asked once: a series asks which occurrences, a single event asks
 * for confirmation. The same questions as the apps.
 */
export function DeleteEventDialog({
  event,
  busy,
  onOpenChange,
  onPick,
}: {
  event: CalendarInstanceDTO | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (range: RecurrenceEdit) => void;
}) {
  const repeats = Boolean(event?.rrule);
  return (
    <Dialog open={event != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {repeats ? "This event repeats" : "Delete this event?"}
          </DialogTitle>
          <DialogDescription>
            {repeats
              ? "Choose which events to delete."
              : event?.title}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {repeats ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => onPick("this")}
              >
                This event
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => onPick("thisAndFollowing")}
              >
                This and following events
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => onPick("all")}
              >
                All events
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => onPick("all")}
            >
              Delete event
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
