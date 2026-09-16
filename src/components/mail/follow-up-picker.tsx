"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Clock,
  Calendar,
  CalendarDays,
  CalendarRange,
  Loader2,
} from "lucide-react";
import { keyboardState } from "@/lib/keyboard-state";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  listFollowUpPresets,
  type FollowUpPresetId,
} from "@/lib/mail/follow-up-presets";

const PRESET_ICONS: Record<
  FollowUpPresetId,
  React.ComponentType<{ className?: string }>
> = {
  oneDay: Clock,
  twoDays: CalendarDays,
  threeDays: Calendar,
  oneWeek: CalendarRange,
  twoWeeks: CalendarRange,
};

interface FollowUpPickerProps {
  onFollowUp: (until: Date) => void;
  isPending?: boolean;
  timezone?: string;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function FollowUpPicker({
  onFollowUp,
  isPending = false,
  timezone = "UTC",
  trigger,
  align = "end",
  side,
  open,
  onOpenChange,
}: FollowUpPickerProps) {
  const now = new Date();
  const options = listFollowUpPresets(now, timezone);

  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const handleOpenChange = (o: boolean) => {
    setInternalOpen(o);
    onOpenChange?.(o);
  };

  const [focusedOption, setFocusedOption] = useState(0);

  const handleSelect = (until: Date) => {
    handleOpenChange(false);
    onFollowUp(until);
  };

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
      const until = options[index]?.until;
      if (until) handleSelect(until);
    },
    [options, handleSelect],
  );

  // Keyboard navigation: j/k, arrows, Enter, number keys
  useEffect(() => {
    if (!isOpen || isPending) return;
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case "j":
        case "ArrowDown": {
          e.preventDefault();
          setFocusedOption((prev) =>
            Math.min(prev + 1, options.length - 1),
          );
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
          selectOption(focusedOption);
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

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        className="w-56 p-0 shadow-overlay"
      >
        <div className="py-1">
          <div className="px-3 py-2">
            <p className="eyebrow text-muted-foreground">
              Follow up if no reply in
            </p>
          </div>
          {options.map((option, index) => {
            const Icon = PRESET_ICONS[option.id];
            return (
              <button
                key={option.id}
                onClick={() => handleSelect(option.until)}
                onMouseEnter={() => setFocusedOption(index)}
                disabled={isPending}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                  focusedOption === index ? "bg-accent" : "hover:bg-accent",
                )}
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Icon className="h-4 w-4 text-muted-foreground" />
                )}
                <div className="flex-1">
                  <span className="font-medium">{option.label}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {option.description}
                </span>
                <kbd className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded border border-border/50 bg-muted/30 px-0.5 font-mono text-[9px] text-muted-foreground/50">
                  {index + 1}
                </kbd>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
