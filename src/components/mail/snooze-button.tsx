"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  Sun,
  Sunrise,
  Calendar,
  CalendarClock,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { snoozeConversation } from "@/actions/snooze";

interface SnoozeButtonProps {
  messageId: string;
  returnPath?: string;
  timezone?: string;
}

interface SnoozeOption {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  getDate: (now: Date, tz: string) => Date | null;
}

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
  minute: number
): Date {
  // Build an ISO string for the target local time, then adjust for TZ offset
  const probe = new Date(year, month, day, hour, minute);
  const utcStr = probe.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = probe.toLocaleString("en-US", { timeZone: tz });
  const diff = new Date(utcStr).getTime() - new Date(tzStr).getTime();
  return new Date(probe.getTime() + diff);
}

function getSnoozeOptions(now: Date, tz: string): SnoozeOption[] {
  const local = getDateInTimezone(now, tz);
  const dayOfWeek = local.getDay(); // 0=Sun, 6=Sat

  const options: SnoozeOption[] = [
    {
      label: "Later today",
      description: local.getHours() < 15 ? "6:00 PM" : `+3 hours`,
      icon: Clock,
      getDate: (now, tz) => {
        const local = getDateInTimezone(now, tz);
        if (local.getHours() < 15) {
          return buildDateInTimezone(
            tz,
            local.getFullYear(),
            local.getMonth(),
            local.getDate(),
            18,
            0
          );
        }
        return new Date(now.getTime() + 3 * 60 * 60 * 1000);
      },
    },
    {
      label: "Tomorrow morning",
      description: "8:00 AM",
      icon: Sunrise,
      getDate: (_now, tz) => {
        const local = getDateInTimezone(_now, tz);
        return buildDateInTimezone(
          tz,
          local.getFullYear(),
          local.getMonth(),
          local.getDate() + 1,
          8,
          0
        );
      },
    },
  ];

  // Only show "This weekend" on weekdays
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    const daysUntilSaturday = 6 - dayOfWeek;
    options.push({
      label: "This weekend",
      description: "Saturday 8:00 AM",
      icon: Sun,
      getDate: (_now, tz) => {
        const local = getDateInTimezone(_now, tz);
        return buildDateInTimezone(
          tz,
          local.getFullYear(),
          local.getMonth(),
          local.getDate() + daysUntilSaturday,
          8,
          0
        );
      },
    });
  }

  // Days until next Monday
  const daysUntilMonday = ((8 - dayOfWeek) % 7) || 7;
  options.push({
    label: "Next week",
    description: "Monday 8:00 AM",
    icon: Calendar,
    getDate: (_now, tz) => {
      const local = getDateInTimezone(_now, tz);
      return buildDateInTimezone(
        tz,
        local.getFullYear(),
        local.getMonth(),
        local.getDate() + daysUntilMonday,
        8,
        0
      );
    },
  });

  return options;
}

export function SnoozeButton({
  messageId,
  returnPath = "/imbox",
  timezone = "UTC",
}: SnoozeButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("08:00");
  const router = useRouter();

  const now = new Date();
  const options = getSnoozeOptions(now, timezone);

  const handleSnooze = (until: Date) => {
    setOpen(false);
    startTransition(async () => {
      await snoozeConversation(messageId, until);
      router.push(returnPath);
      router.refresh();
    });
  };

  const handleCustomSubmit = () => {
    if (!customDate || !customTime) return;
    const [year, month, day] = customDate.split("-").map(Number);
    const [hour, minute] = customTime.split(":").map(Number);
    const until = buildDateInTimezone(timezone, year, month - 1, day, hour, minute);
    if (until <= now) return;
    handleSnooze(until);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setShowCustom(false); }}>
      <PopoverTrigger asChild>
        <button
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Clock className="h-3.5 w-3.5" />
          )}
          Snooze
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        {!showCustom ? (
          <div className="py-1">
            <div className="px-3 py-2">
              <p className="text-sm font-medium">Snooze until...</p>
            </div>
            {options.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.label}
                  onClick={() => {
                    const date = option.getDate(now, timezone);
                    if (date) handleSnooze(date);
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
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                min={now.toISOString().split("T")[0]}
                className="w-full rounded-md border bg-transparent px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
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
                  "disabled:opacity-50"
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
