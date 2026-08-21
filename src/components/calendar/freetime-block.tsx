"use client";

import type { CSSProperties } from "react";
import { formatFreetimeLabel } from "@/lib/calendar/view-time";
import { cn } from "@/lib/utils";

/**
 * A bounded freetime span. The wash + hairlines are visual only and let
 * pointer events through (week-grid drag-create must keep working across
 * a gap); the label is the click target that claims the whole span.
 */
export function FreetimeBlock({
  minutes,
  onSelect,
  className,
  style,
}: {
  minutes: number;
  onSelect?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none border-y border-border/70",
        className,
      )}
      style={{
        background: "color-mix(in srgb, var(--primary) 6%, transparent)",
        ...style,
      }}
    >
      {onSelect ? (
        <button
          type="button"
          className="pointer-events-auto m-1 rounded-xs px-0.5 text-xs tabular-nums text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          {formatFreetimeLabel(minutes)}
        </button>
      ) : (
        <span className="m-1 inline-block px-0.5 text-xs tabular-nums text-muted-foreground">
          {formatFreetimeLabel(minutes)}
        </span>
      )}
    </div>
  );
}
