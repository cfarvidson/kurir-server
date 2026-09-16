"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { keyboardState } from "@/lib/keyboard-state";
import {
  Clock,
  Sun,
  Sunrise,
  Calendar,
  CalendarClock,
  CalendarDays,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  buildDateInTimezone,
  defaultCustomSnooze,
  listSnoozePresets,
  todayIsoDate,
  type SnoozePresetId,
} from "@/lib/mail/snooze-presets";

const PRESET_ICONS: Record<
  SnoozePresetId,
  React.ComponentType<{ className?: string }>
> = {
  laterToday: Clock,
  tomorrow: Sunrise,
  dayAfter: CalendarDays,
  inThreeDays: Calendar,
  weekend: Sun,
  nextWeek: Calendar,
  custom: CalendarClock,
};

interface SnoozPickerProps {
  onSnooze: (until: Date) => void;
  isPending?: boolean;
  timezone?: string;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SnoozePicker({
  onSnooze,
  isPending = false,
  timezone = "UTC",
  trigger,
  align = "end",
  side,
  open,
  onOpenChange,
}: SnoozPickerProps) {
  const now = new Date();
  const todayStr = todayIsoDate(now, timezone);
  const customDefault = defaultCustomSnooze(now, timezone);

  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const handleOpenChange = (o: boolean) => {
    setInternalOpen(o);
    onOpenChange?.(o);
    if (!o) setShowCustom(false);
  };
  const [showCustom, setShowCustom] = useState(false);
  const [customDate, setCustomDate] = useState(customDefault.date);
  const [customTime, setCustomTime] = useState(customDefault.time);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const presets = listSnoozePresets(now, timezone);
  const options = presets.filter((preset) => preset.until);
  const [focusedOption, setFocusedOption] = useState(0);

  // Reset focused option when opening
  useEffect(() => {
    if (isOpen) {
      setFocusedOption(0);
    }
  }, [isOpen]);

  // Set popoverOpen flag so list keyboard handler defers
  useEffect(() => {
    keyboardState.popoverOpen = isOpen;
    return () => {
      keyboardState.popoverOpen = false;
    };
  }, [isOpen]);

  const selectOption = useCallback(
    (index: number) => {
      const date = options[index]?.until;
      if (date) {
        handleOpenChange(false);
        onSnooze(date);
      }
    },
    [options, handleOpenChange, onSnooze],
  );

  const openCustom = () => {
    const next = defaultCustomSnooze(now, timezone);
    setCustomDate(next.date);
    setCustomTime(next.time);
    setShowCustom(true);
  };

  // Total items: dated presets + "Pick a date…"
  const totalItems = options.length + 1;
  const customIndex = options.length;

  // Keyboard navigation: j/k, arrows, Enter, number keys
  useEffect(() => {
    if (!isOpen || showCustom || isPending) return;
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "j":
        case "ArrowDown": {
          e.preventDefault();
          setFocusedOption((prev) => Math.min(prev + 1, totalItems - 1));
          break;
        }
        case "k":
        case "ArrowUp": {
          e.preventDefault();
          setFocusedOption((prev) => Math.max(prev - 1, 0));
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (focusedOption === customIndex) {
            openCustom();
          } else {
            selectOption(focusedOption);
          }
          break;
        }
        default: {
          const num = parseInt(e.key);
          if (num >= 1 && num <= options.length) {
            e.preventDefault();
            selectOption(num - 1);
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const handleSnooze = (until: Date) => {
    handleOpenChange(false);
    onSnooze(until);
  };

  const handleCustomSubmit = () => {
    if (!customDate || !customTime) return;
    const [year, month, day] = customDate.split("-").map(Number);
    const [hour, minute] = customTime.split(":").map(Number);
    const until = buildDateInTimezone(
      timezone,
      year,
      month - 1,
      day,
      hour,
      minute,
    );
    if (until <= now) return;
    handleSnooze(until);
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        className="w-64 p-0 shadow-overlay"
        onInteractOutside={(e) => {
          // Prevent Radix from closing the popover when the browser's
          // native date/time picker overlay is opened (it lives outside the DOM)
          if (showCustom) e.preventDefault();
        }}
        onFocusOutside={(e) => {
          if (showCustom) e.preventDefault();
        }}
      >
        {!showCustom ? (
          <div className="py-1">
            <div className="px-3 py-2">
              <p className="eyebrow text-muted-foreground">Snooze until</p>
            </div>
            {options.map((option, index) => {
              const Icon = PRESET_ICONS[option.id];
              return (
                <button
                  key={option.id}
                  onClick={() => {
                    if (option.until) handleSnooze(option.until);
                  }}
                  onMouseEnter={() => setFocusedOption(index)}
                  disabled={isPending}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                    focusedOption === index ? "bg-accent" : "hover:bg-accent",
                  )}
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <span className="font-medium">{option.label}</span>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {option.description}
                  </span>
                  <kbd className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded border border-border/50 bg-muted/30 px-0.5 font-mono text-[9px] text-muted-foreground/50">
                    {index + 1}
                  </kbd>
                </button>
              );
            })}
            <div className="border-t border-border" />
            <button
              onClick={openCustom}
              onMouseEnter={() => setFocusedOption(customIndex)}
              disabled={isPending}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                focusedOption === customIndex ? "bg-accent" : "hover:bg-accent",
              )}
            >
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Pick a date…</span>
            </button>
          </div>
        ) : (
          <div className="p-3">
            <p className="eyebrow mb-3 text-muted-foreground">
              Pick date &amp; time
            </p>
            <div className="space-y-2">
              <div className="relative">
                <input
                  ref={dateInputRef}
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  min={todayStr}
                  className="w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-sm tabular-nums focus:outline-hidden focus:ring-1 focus:ring-ring [&::-webkit-calendar-picker-indicator]:pointer-events-none [&::-webkit-calendar-picker-indicator]:opacity-0"
                  onClick={() => dateInputRef.current?.showPicker?.()}
                />
              </div>
              <input
                type="time"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                className="w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-sm tabular-nums focus:outline-hidden focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setShowCustom(false)}
                className="flex-1 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                Back
              </button>
              <button
                onClick={handleCustomSubmit}
                disabled={!customDate || !customTime || isPending}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                  "disabled:opacity-50",
                )}
              >
                {isPending ? (
                  <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Snooze"
                )}
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
