"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateCalendarAvailability } from "@/actions/user";
import {
  AVAILABILITY_STEP_MINUTES,
  DEFAULT_AVAILABILITY,
  type AvailabilityDay,
  type CalendarAvailability,
} from "@/lib/calendar/availability";
import { formatDurationLabel } from "@/lib/calendar/view-time";
import { cn } from "@/lib/utils";

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const TIMES = Array.from(
  { length: (24 * 60) / AVAILABILITY_STEP_MINUTES + 1 },
  (_, i) => i * AVAILABILITY_STEP_MINUTES,
);

function clock(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

const GRID =
  "grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-x-4 sm:grid-cols-[110px_190px_minmax(0,200px)_minmax(0,1fr)]";

const SELECT =
  "h-[30px] rounded-[7px] border border-border bg-card px-2 text-[13px] tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:bg-transparent disabled:text-muted-foreground/60";

const QUICK =
  "rounded-lg border border-border px-3 py-[7px] text-[12.5px] font-medium hover:bg-accent disabled:opacity-50";

/**
 * The hours a person counts as their own, per weekday. Open time in every
 * calendar view is only counted inside them, and the hours outside are
 * shaded. Saves on every change, like the timezone; a failed save reverts.
 */
export function AvailableTime({ initial }: { initial: CalendarAvailability }) {
  const [value, setValue] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function save(next: CalendarAvailability) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      try {
        await updateCalendarAvailability(next);
      } catch {
        setValue(previous);
        toast.error("Could not save available time");
      }
    });
  }

  function setDay(index: number, patch: Partial<AvailabilityDay>) {
    save({
      days: value.days.map((day, i) =>
        i === index ? { ...day, ...patch } : day,
      ),
    });
  }

  return (
    <div>
      <div
        className={cn(
          GRID,
          "border-b border-border pb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground",
        )}
      >
        <span>Day</span>
        <span>Hours</span>
        <span className="hidden sm:block">00 – 24</span>
        <span className="text-right">Length</span>
      </div>

      {value.days.map((day, i) => (
        <div
          key={DAYS[i]}
          className={cn(GRID, "h-[50px] border-b border-border/70")}
        >
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold">
            <input
              type="checkbox"
              checked={day.on}
              onChange={() => setDay(i, { on: !day.on })}
              className="size-4 accent-primary"
            />
            {DAYS[i]}
          </label>
          <div className="flex items-center gap-1.5">
            <select
              aria-label={`${DAYS[i]} from`}
              value={day.start}
              disabled={!day.on}
              onChange={(e) => setDay(i, { start: Number(e.target.value) })}
              className={SELECT}
            >
              {TIMES.filter((t) => t < day.end).map((t) => (
                <option key={t} value={t}>
                  {clock(t)}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">–</span>
            <select
              aria-label={`${DAYS[i]} to`}
              value={day.end}
              disabled={!day.on}
              onChange={(e) => setDay(i, { end: Number(e.target.value) })}
              className={SELECT}
            >
              {TIMES.filter((t) => t > day.start).map((t) => (
                <option key={t} value={t}>
                  {clock(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="relative hidden h-2.5 overflow-hidden rounded-[5px] bg-border sm:block">
            {day.on && (
              <div
                className="absolute inset-y-0 rounded-[5px] bg-primary/80"
                style={{
                  left: `${(day.start / (24 * 60)) * 100}%`,
                  width: `${((day.end - day.start) / (24 * 60)) * 100}%`,
                }}
              />
            )}
          </div>
          <span
            className={cn(
              "text-right text-[13px] tabular-nums",
              !day.on && "text-muted-foreground",
            )}
          >
            {day.on
              ? formatDurationLabel(day.end - day.start)
              : "Not available"}
          </span>
        </div>
      ))}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={QUICK}
          disabled={isPending}
          onClick={() =>
            save({ days: value.days.map(() => ({ ...value.days[0] })) })
          }
        >
          Use Monday for every day
        </button>
        <button
          type="button"
          className={QUICK}
          disabled={isPending}
          onClick={() =>
            save({ days: value.days.map((day, i) => ({ ...day, on: i < 5 })) })
          }
        >
          Weekdays only
        </button>
        <button
          type="button"
          className={QUICK}
          disabled={isPending}
          onClick={() => save(DEFAULT_AVAILABILITY)}
        >
          Reset to 07:00–21:00
        </button>
        {isPending && (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        )}
      </div>
      <p className="mt-3.5 text-xs text-muted-foreground">
        Saved to your account. iPhone, Mac and the web use the same hours.
      </p>
    </div>
  );
}
