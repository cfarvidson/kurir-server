"use client";

import type { CSSProperties } from "react";
import type { OpenSpan } from "@/components/calendar/agenda-model";
import { formatDurationLabel } from "@/lib/calendar/view-time";
import { cn } from "@/lib/utils";

/** "Longest stretch today", "Passed", "9 min left", or nothing. */
export function openSpanNote(span: OpenSpan): string {
  if (span.isLongest) return "Longest stretch today";
  if (span.state === "passed") return "Passed";
  if (span.state === "now")
    return `${formatDurationLabel(span.remaining)} left`;
  return "";
}

/**
 * A counted open span in today's column: a dashed accent box. The box
 * lets pointer events through (drag-create must keep working across it);
 * the label is the click target that claims the span.
 */
export function FreetimeBlock({
  span,
  onSelect,
  className,
  style,
}: {
  span: OpenSpan;
  onSelect?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const label = `+ ${formatDurationLabel(span.minutes)} open`;
  const note = openSpanNote(span);
  return (
    <div
      className={cn(
        "pointer-events-none flex items-start justify-between gap-2 rounded-lg border border-dashed border-primary/35 px-2.5 py-1.5",
        span.isLongest ? "bg-primary/7" : "bg-primary/3",
        span.state === "passed" && "opacity-45",
        className,
      )}
      style={style}
    >
      {onSelect ? (
        <button
          type="button"
          aria-label={`New event, ${formatDurationLabel(span.minutes)} open`}
          className="pointer-events-auto rounded-xs text-[12.5px] font-semibold tabular-nums text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          {label}
        </button>
      ) : (
        <span className="text-[12.5px] font-semibold tabular-nums text-primary">
          {label}
        </span>
      )}
      {note && (
        <span className="truncate text-[11.5px] text-primary">{note}</span>
      )}
    </div>
  );
}
