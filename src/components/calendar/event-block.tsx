"use client";

import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { eventBlockStyle } from "@/lib/calendar/color";
import { cn } from "@/lib/utils";

export function EventBlock({
  title,
  color,
  timeLabel,
  className,
  style,
  muted,
  onClick,
  onPointerDown,
  onResizePointerDown,
}: {
  title: string;
  color: string;
  timeLabel?: string;
  className?: string;
  style?: CSSProperties;
  muted?: boolean;
  onClick?: () => void;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  onResizePointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!onClick) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      onKeyDown={handleKey}
      onPointerDown={onPointerDown}
      className={cn(
        "relative overflow-hidden rounded-xs text-left font-sans leading-tight text-foreground",
        "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        muted && "opacity-70",
        className,
      )}
      style={
        {
          ...eventBlockStyle(color),
          borderLeft: "2px solid var(--event-color)",
          backgroundColor: "var(--event-fill)",
          ...style,
        } as CSSProperties
      }
    >
      <span className="block truncate px-1.5 py-0.5 text-xs font-medium">
        {timeLabel ? `${timeLabel} ${title}` : title}
      </span>
      {onResizePointerDown && (
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-s-resize"
          onPointerDown={onResizePointerDown}
        />
      )}
    </div>
  );
}
