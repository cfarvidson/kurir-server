"use client";

import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { normalizeEventHex, readableTextTone } from "@/lib/calendar/color";
import { cn } from "@/lib/utils";

/**
 * An event as a solid block of its calendar's color — the same HEY-style
 * chrome as the day strip's slats, so events read identically across
 * views. `muted` (transparency=free) renders as a hatched outline. The
 * fixed text tones are theme-safe because they sit on the fixed hex.
 */
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
  const fill = normalizeEventHex(color);
  const tone = readableTextTone(fill);

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
        "relative overflow-hidden rounded-xs text-left font-sans leading-tight",
        "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        muted
          ? "text-foreground"
          : tone === "light"
            ? "text-white"
            : "text-zinc-950",
        className,
      )}
      style={
        {
          ...(muted
            ? {
                backgroundImage: `repeating-linear-gradient(135deg, ${fill}33 0 5px, transparent 5px 10px)`,
                boxShadow: `inset 0 0 0 1px ${fill}66`,
              }
            : { backgroundColor: fill }),
          ...style,
        } as CSSProperties
      }
    >
      <span className="block truncate px-1.5 py-0.5 text-xs font-semibold">
        {timeLabel ? (
          <>
            <span
              className={cn(
                "font-normal tabular-nums",
                muted
                  ? "text-muted-foreground"
                  : tone === "light"
                    ? "text-white/75"
                    : "text-zinc-950/70",
              )}
            >
              {timeLabel}
            </span>{" "}
            {title}
          </>
        ) : (
          title
        )}
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
