"use client";

import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from "react";
import { normalizeEventHex, readableTextTone } from "@/lib/calendar/color";
import { cn } from "@/lib/utils";

/**
 * An event block. Solid (the default) is a fill of the calendar colour with
 * a readable fixed text tone - all-day and multi-day bars. `tinted` is the
 * timed-event look: the calendar colour washed over the surface with a
 * darkened/lightened title (see .cal-tint). `muted` (transparency=free)
 * renders as a hatched outline either way. `children` replaces the default
 * one-line label when a view needs more (today's column: title, time,
 * place).
 */
export function EventBlock({
  title,
  color,
  timeLabel,
  className,
  style,
  muted,
  tinted,
  children,
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
  tinted?: boolean;
  children?: ReactNode;
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
      aria-label={children ? title : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      onKeyDown={handleKey}
      onPointerDown={onPointerDown}
      className={cn(
        "relative overflow-hidden text-left font-sans leading-tight",
        "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        muted
          ? "text-foreground"
          : tinted
            ? "cal-tint"
            : tone === "light"
              ? "text-white"
              : "text-zinc-950",
        tinted ? "rounded-[5px]" : "rounded-xs",
        className,
      )}
      style={
        {
          ...({ "--ev": fill } as CSSProperties),
          ...(muted
            ? {
                backgroundImage: `repeating-linear-gradient(135deg, ${fill}33 0 5px, transparent 5px 10px)`,
                boxShadow: `inset 0 0 0 1px ${fill}66`,
              }
            : tinted
              ? {}
              : { backgroundColor: fill }),
          ...style,
        } as CSSProperties
      }
    >
      {children ?? (
        <span
          className={cn(
            "block truncate px-1.5 py-0.5 text-[11px] font-semibold",
          )}
        >
          {timeLabel ? (
            <>
              <span
                className={cn(
                  "font-normal tabular-nums",
                  muted || tinted
                    ? "opacity-70"
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
      )}
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
