"use client";

import { useState, useEffect, useCallback } from "react";
import { Clock, CalendarDays, CalendarRange, Loader2 } from "lucide-react";
import { keyboardState } from "@/lib/keyboard-state";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface FollowUpOption {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  getDuration: () => number; // milliseconds
}

const FOLLOW_UP_OPTIONS: FollowUpOption[] = [
  {
    label: "1 day",
    description: "Tomorrow",
    icon: Clock,
    getDuration: () => 24 * 60 * 60 * 1000,
  },
  {
    label: "3 days",
    description: "In 3 days",
    icon: CalendarDays,
    getDuration: () => 3 * 24 * 60 * 60 * 1000,
  },
  {
    label: "1 week",
    description: "In 7 days",
    icon: CalendarRange,
    getDuration: () => 7 * 24 * 60 * 60 * 1000,
  },
  {
    label: "2 weeks",
    description: "In 14 days",
    icon: CalendarRange,
    getDuration: () => 14 * 24 * 60 * 60 * 1000,
  },
];

interface FollowUpPickerProps {
  onFollowUp: (until: Date) => void;
  isPending?: boolean;
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function FollowUpPicker({
  onFollowUp,
  isPending = false,
  trigger,
  align = "end",
  side,
  open,
  onOpenChange,
}: FollowUpPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const handleOpenChange = (o: boolean) => {
    setInternalOpen(o);
    onOpenChange?.(o);
  };

  const [focusedOption, setFocusedOption] = useState(0);

  const handleSelect = (option: FollowUpOption) => {
    handleOpenChange(false);
    const until = new Date(Date.now() + option.getDuration());
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
      if (index >= 0 && index < FOLLOW_UP_OPTIONS.length) {
        handleSelect(FOLLOW_UP_OPTIONS[index]);
      }
    },
    [handleSelect],
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
            Math.min(prev + 1, FOLLOW_UP_OPTIONS.length - 1),
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
          if (num >= 1 && num <= FOLLOW_UP_OPTIONS.length) {
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
      <PopoverContent align={align} side={side} className="w-56 p-0">
        <div className="py-1">
          <div className="px-3 py-2">
            <p className="text-sm font-medium">Follow up if no reply in...</p>
          </div>
          {FOLLOW_UP_OPTIONS.map((option, index) => {
            const Icon = option.icon;
            return (
              <button
                key={option.label}
                onClick={() => handleSelect(option)}
                onMouseEnter={() => setFocusedOption(index)}
                disabled={isPending}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                  focusedOption === index ? "bg-muted" : "hover:bg-muted",
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
