"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createEventAction,
  deleteEventAction,
  updateEventAction,
} from "@/actions/calendar";
import type {
  CalendarAccountDTO,
  CalendarInstanceDTO,
  SlotSelection,
} from "@/components/calendar/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addDays,
  allDayRangeUtc,
  civilFromAllDayUtc,
  formatDateParam,
  parseDateParam,
  rruleFromPreset,
  rrulePreset,
  zonedParts,
  zonedWallToUtc,
} from "@/lib/calendar/view-time";
import type { EventInput, RecurrenceEdit } from "@/lib/calendar/providers/types";
import { cn } from "@/lib/utils";

type Draft = {
  title: string;
  calendarId: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string;
  notes: string;
  repeat: string;
  existingRrule: string | null;
};

const REPEAT_OPTIONS = [
  { value: "", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "weekdays", label: "Weekdays" },
  { value: "monthly", label: "Monthly" },
] as const;

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function timeFromMinutes(min: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, min));
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

function defaultCalendarId(accounts: CalendarAccountDTO[]): string {
  const writable = accounts.flatMap((account) =>
    account.calendars.filter((calendar) => !calendar.isReadOnly),
  );
  return (
    writable.find((calendar) => calendar.isPrimary)?.id ??
    writable[0]?.id ??
    accounts[0]?.calendars[0]?.id ??
    ""
  );
}

function draftFromSlot(
  slot: SlotSelection,
  accounts: CalendarAccountDTO[],
): Draft {
  return {
    title: "",
    calendarId: defaultCalendarId(accounts),
    startDate: slot.date,
    endDate: slot.date,
    startTime: timeFromMinutes(slot.startMin),
    endTime: timeFromMinutes(Math.max(slot.endMin, slot.startMin + 30)),
    allDay: slot.allDay,
    location: "",
    notes: "",
    repeat: "",
    existingRrule: null,
  };
}

function draftFromEvent(
  event: CalendarInstanceDTO,
  timezone: string,
): Draft {
  let startDate: string;
  let endDate: string;
  let startTime = "09:00";
  let endTime = "10:00";
  if (event.isAllDay) {
    const start = civilFromAllDayUtc(new Date(event.startAt));
    const endExclusive = civilFromAllDayUtc(new Date(event.endAt));
    const end =
      formatDateParam(endExclusive) <= formatDateParam(start)
        ? start
        : addDays(endExclusive, -1);
    startDate = formatDateParam(start);
    endDate = formatDateParam(end);
  } else {
    const start = zonedParts(new Date(event.startAt), timezone);
    const end = zonedParts(new Date(event.endAt), timezone);
    startDate = formatDateParam(start);
    endDate = formatDateParam(end);
    startTime = `${pad(start.hour)}:${pad(start.minute)}`;
    endTime = `${pad(end.hour)}:${pad(end.minute)}`;
  }
  const preset = rrulePreset(event.rrule);
  return {
    title: event.title,
    calendarId: event.calendarId,
    startDate,
    endDate,
    startTime,
    endTime,
    allDay: event.isAllDay,
    location: event.location ?? "",
    notes: event.description ?? "",
    repeat: preset === "custom" ? "custom" : preset,
    existingRrule: event.rrule,
  };
}

function toEventInput(draft: Draft, timezone: string): EventInput {
  const startDay = parseDateParam(draft.startDate, timezone);
  const endDay = parseDateParam(draft.endDate, timezone);
  if (draft.allDay) {
    const endExclusive =
      formatDateParam(endDay) < formatDateParam(startDay)
        ? addDays(startDay, 1)
        : addDays(endDay, 1);
    const range = allDayRangeUtc(startDay, endExclusive);
    return {
      title: draft.title.trim() || "New event",
      description: draft.notes.trim() || null,
      location: draft.location.trim() || null,
      startAt: range.startAt,
      endAt: range.endAt,
      isAllDay: true,
      timezone: null,
      rrule: rruleFromDraft(draft),
    };
  }
  const [startHour, startMinute] = draft.startTime.split(":").map(Number);
  const [endHour, endMinute] = draft.endTime.split(":").map(Number);
  let startAt = zonedWallToUtc(timezone, {
    ...startDay,
    hour: startHour || 0,
    minute: startMinute || 0,
  });
  let endAt = zonedWallToUtc(timezone, {
    ...endDay,
    hour: endHour || 0,
    minute: endMinute || 0,
  });
  if (endAt <= startAt) {
    endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
  }
  return {
    title: draft.title.trim() || "New event",
    description: draft.notes.trim() || null,
    location: draft.location.trim() || null,
    startAt,
    endAt,
    isAllDay: false,
    timezone,
    rrule: rruleFromDraft(draft),
  };
}

function rruleFromDraft(draft: Draft): string | null {
  if (draft.repeat === "custom") return draft.existingRrule;
  return rruleFromPreset(draft.repeat);
}

function fieldClass(className?: string) {
  return cn(
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base md:text-sm",
    "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
    "disabled:cursor-not-allowed disabled:opacity-50",
    className,
  );
}

export function RecurrenceRangeDialog({
  open,
  onOpenChange,
  title,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onPick: (range: RecurrenceEdit) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Choose which events to change.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" onClick={() => onPick("this")}>
            This event
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onPick("thisAndFollowing")}
          >
            This and following events
          </Button>
          <Button type="button" variant="outline" onClick={() => onPick("all")}>
            All events
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EventDialog({
  open,
  onOpenChange,
  timezone,
  accounts,
  event,
  slot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
  accounts: CalendarAccountDTO[];
  event: CalendarInstanceDTO | null;
  slot: SlotSelection | null;
}) {
  const router = useRouter();
  const identity = event
    ? `e:${event.eventId}:${event.startAt}`
    : slot
      ? `s:${slot.date}:${slot.startMin}:${slot.endMin}:${slot.allDay}`
      : "none";
  const [seen, setSeen] = useState(identity);
  const [draft, setDraft] = useState<Draft | null>(() =>
    event
      ? draftFromEvent(event, timezone)
      : slot
        ? draftFromSlot(slot, accounts)
        : null,
  );
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<"save" | "delete" | null>(null);

  if (identity !== seen) {
    setSeen(identity);
    setDraft(
      event
        ? draftFromEvent(event, timezone)
        : slot
          ? draftFromSlot(slot, accounts)
          : null,
    );
    setPending(null);
  }

  const readOnly = event?.isReadOnly === true;
  const isSeries = Boolean(event?.rrule);

  const calendars = useMemo(
    () =>
      accounts.flatMap((account) =>
        account.calendars
          .filter(
            (calendar) =>
              !calendar.isReadOnly || calendar.id === event?.calendarId,
          )
          .map((calendar) => ({
            ...calendar,
            accountName: account.displayName,
          })),
      ),
    [accounts, event],
  );

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function runSave(range: RecurrenceEdit) {
    if (!draft) return;
    setSaving(true);
    try {
      const input = toEventInput(draft, timezone);
      if (event) {
        await updateEventAction(
          event.eventId,
          { ...input, calendarId: draft.calendarId },
          range,
        );
      } else {
        await createEventAction(draft.calendarId, input);
      }
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save event");
    } finally {
      setSaving(false);
      setPending(null);
    }
  }

  async function runDelete(range: RecurrenceEdit) {
    if (!event) return;
    setSaving(true);
    try {
      await deleteEventAction(event.eventId, range);
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete event");
    } finally {
      setSaving(false);
      setPending(null);
    }
  }

  function handleSave() {
    if (!draft || readOnly) return;
    if (!draft.calendarId) {
      toast.error("Choose a calendar");
      return;
    }
    if (event && isSeries) {
      setPending("save");
      return;
    }
    void runSave("all");
  }

  function handleDelete() {
    if (!event || readOnly) return;
    if (isSeries) {
      setPending("delete");
      return;
    }
    void runDelete("all");
  }

  function handleDialogOpenChange(next: boolean) {
    if (!next && pending) {
      setPending(null);
      return;
    }
    onOpenChange(next);
  }

  if (!draft) return null;

  const rangeTitle =
    pending === "delete" ? "Delete recurring event" : "Edit recurring event";

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-md">
        {pending ? (
          <>
            <DialogHeader>
              <DialogTitle>{rangeTitle}</DialogTitle>
              <DialogDescription>Choose which events to change.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() =>
                  pending === "delete" ? void runDelete("this") : void runSave("this")
                }
              >
                This event
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() =>
                  pending === "delete"
                    ? void runDelete("thisAndFollowing")
                    : void runSave("thisAndFollowing")
                }
              >
                This and following events
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() =>
                  pending === "delete" ? void runDelete("all") : void runSave("all")
                }
              >
                All events
              </Button>
            </div>
          </>
        ) : (
          <>
          <DialogHeader>
            <DialogTitle>{event ? "Event" : "New event"}</DialogTitle>
            <DialogDescription>
              {readOnly ? "Subscribe" : "Title, time, and calendar for this event."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cal-title">Title</Label>
              <Input
                id="cal-title"
                value={draft.title}
                onChange={(e) => update("title", e.target.value)}
                disabled={readOnly}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cal-calendar">Calendar</Label>
              <select
                id="cal-calendar"
                className={fieldClass()}
                value={draft.calendarId}
                onChange={(e) => update("calendarId", e.target.value)}
                disabled={readOnly}
              >
                {calendars.map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.accountName} - {calendar.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={draft.allDay}
                disabled={readOnly}
                onChange={(e) => update("allDay", e.target.checked)}
              />
              All-day
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="cal-start-date">Start</Label>
                <Input
                  id="cal-start-date"
                  type="date"
                  value={draft.startDate}
                  disabled={readOnly}
                  onChange={(e) => update("startDate", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cal-end-date">End</Label>
                <Input
                  id="cal-end-date"
                  type="date"
                  value={draft.endDate}
                  disabled={readOnly}
                  onChange={(e) => update("endDate", e.target.value)}
                />
              </div>
              {!draft.allDay && (
                <>
                  <Input
                    type="time"
                    value={draft.startTime}
                    disabled={readOnly}
                    onChange={(e) => update("startTime", e.target.value)}
                  />
                  <Input
                    type="time"
                    value={draft.endTime}
                    disabled={readOnly}
                    onChange={(e) => update("endTime", e.target.value)}
                  />
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cal-location">Location</Label>
              <Input
                id="cal-location"
                value={draft.location}
                disabled={readOnly}
                onChange={(e) => update("location", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cal-notes">Notes</Label>
              <textarea
                id="cal-notes"
                value={draft.notes}
                disabled={readOnly}
                onChange={(e) => update("notes", e.target.value)}
                className={fieldClass("h-20 py-2")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cal-repeat">Repeat</Label>
              <select
                id="cal-repeat"
                className={fieldClass()}
                value={draft.repeat === "custom" ? "custom" : draft.repeat}
                disabled={readOnly}
                onChange={(e) => update("repeat", e.target.value)}
              >
                {REPEAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                {draft.repeat === "custom" && (
                  <option value="custom">Custom</option>
                )}
              </select>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {event && !readOnly ? (
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={handleDelete}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            {!readOnly && (
              <Button type="button" disabled={saving} onClick={handleSave}>
                {saving ? "Saving..." : "Save"}
              </Button>
            )}
          </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
