"use client";

import { useState, useRef } from "react";
import { Clock, Sunrise, Sun, CalendarClock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

function getDateInTimezone(date: Date, tz: string): Date {
  const str = date.toLocaleString("en-US", { timeZone: tz });
  return new Date(str);
}

function buildDateInTimezone(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const probe = new Date(year, month, day, hour, minute);
  const utcStr = probe.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = probe.toLocaleString("en-US", { timeZone: tz });
  const diff = new Date(utcStr).getTime() - new Date(tzStr).getTime();
  return new Date(probe.getTime() + diff);
}

interface ScheduleOption {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  getDate: (now: Date, tz: string) => Date | null;
}

function getScheduleOptions(now: Date, tz: string): ScheduleOption[] {
  const local = getDateInTimezone(now, tz);
  const dayOfWeek = local.getDay(); // 0=Sun, 1=Mon, ... 6=Sat

  const options: ScheduleOption[] = [];

  // "Later today" at 6 PM — only show if before 4 PM in user timezone
  if (local.getHours() < 16) {
    options.push({
      label: "Later today",
      description: "6:00 PM",
      icon: Clock,
      getDate: (_now, tz) => {
        const l = getDateInTimezone(_now, tz);
        return buildDateInTimezone(
          tz,
          l.getFullYear(),
          l.getMonth(),
          l.getDate(),
          18,
          0,
        );
      },
    });
  }

  // "Tomorrow morning" at 8 AM
  options.push({
    label: "Tomorrow morning",
    description: "8:00 AM",
    icon: Sunrise,
    getDate: (_now, tz) => {
      const l = getDateInTimezone(_now, tz);
      return buildDateInTimezone(
        tz,
        l.getFullYear(),
        l.getMonth(),
        l.getDate() + 1,
        8,
        0,
      );
    },
  });

  // "Tomorrow afternoon" at 1 PM
  options.push({
    label: "Tomorrow afternoon",
    description: "1:00 PM",
    icon: Sun,
    getDate: (_now, tz) => {
      const l = getDateInTimezone(_now, tz);
      return buildDateInTimezone(
        tz,
        l.getFullYear(),
        l.getMonth(),
        l.getDate() + 1,
        13,
        0,
      );
    },
  });

  // "Next Monday morning" at 8 AM — only show Tue-Fri (dayOfWeek 2-5)
  if (dayOfWeek >= 2 && dayOfWeek <= 5) {
    const daysUntilMonday = ((8 - dayOfWeek) % 7) || 7;
    options.push({
      label: "Next Monday morning",
      description: "Monday 8:00 AM",
      icon: Sunrise,
      getDate: (_now, tz) => {
        const l = getDateInTimezone(_now, tz);
        return buildDateInTimezone(
          tz,
          l.getFullYear(),
          l.getMonth(),
          l.getDate() + daysUntilMonday,
          8,
          0,
        );
      },
    });
  }

  return options;
}

interface SchedulePickerProps {
  onSchedule: (date: Date) => void;
  userTimezone: string;
  isPending?: boolean;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SchedulePicker({
  onSchedule,
  userTimezone,
  isPending = false,
  trigger,
  align = "end",
  side,
  open,
  onOpenChange,
}: SchedulePickerProps) {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const handleOpenChange = (o: boolean) => {
    setInternalOpen(o);
    onOpenChange?.(o);
    if (!o) setShowCustom(false);
  };
  const [showCustom, setShowCustom] = useState(false);
  const [customDate, setCustomDate] = useState(todayStr);
  const [customTime, setCustomTime] = useState("08:00");
  const dateInputRef = useRef<HTMLInputElement>(null);

  const options = getScheduleOptions(now, userTimezone);

  const handleSchedule = (date: Date) => {
    handleOpenChange(false);
    onSchedule(date);
  };

  const handleCustomSubmit = () => {
    if (!customDate || !customTime) return;
    const [year, month, day] = customDate.split("-").map(Number);
    const [hour, minute] = customTime.split(":").map(Number);
    const scheduled = buildDateInTimezone(
      userTimezone,
      year,
      month - 1,
      day,
      hour,
      minute,
    );
    if (scheduled <= now) return;
    handleSchedule(scheduled);
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        className="w-64 p-0"
        onInteractOutside={(e) => {
          if (showCustom) e.preventDefault();
        }}
        onFocusOutside={(e) => {
          if (showCustom) e.preventDefault();
        }}
      >
        {!showCustom ? (
          <div className="py-1">
            <div className="px-3 py-2">
              <p className="text-sm font-medium">Schedule send...</p>
            </div>
            {options.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.label}
                  onClick={() => {
                    const date = option.getDate(now, userTimezone);
                    if (date) handleSchedule(date);
                  }}
                  disabled={isPending}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <span className="font-medium">{option.label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </button>
              );
            })}
            <div className="border-t" />
            <button
              onClick={() => setShowCustom(true)}
              disabled={isPending}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
            >
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Pick date &amp; time</span>
            </button>
          </div>
        ) : (
          <div className="p-3">
            <p className="mb-3 text-sm font-medium">Pick date &amp; time</p>
            <div className="space-y-2">
              <div className="relative">
                <input
                  ref={dateInputRef}
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  min={todayStr}
                  className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring [&::-webkit-calendar-picker-indicator]:pointer-events-none [&::-webkit-calendar-picker-indicator]:opacity-0"
                  onClick={() => dateInputRef.current?.showPicker?.()}
                />
              </div>
              <input
                type="time"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setShowCustom(false)}
                className="flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
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
                  "Schedule"
                )}
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
