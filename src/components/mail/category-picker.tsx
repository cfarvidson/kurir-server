"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Newspaper, Receipt, X, Check, Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { changeSenderCategory, rejectSender } from "@/actions/senders";
import { cn } from "@/lib/utils";
import type { SenderCategory } from "@prisma/client";

const CATEGORY_CONFIG = {
  IMBOX: {
    label: "Imbox",
    icon: Inbox,
    color: "text-primary bg-primary/10",
    iconColor: "text-primary",
  },
  FEED: {
    label: "Feed",
    icon: Newspaper,
    color: "text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  PAPER_TRAIL: {
    label: "Paper Trail",
    icon: Receipt,
    color:
      "text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
} as const;

interface CategoryPickerProps {
  senderId: string;
  currentCategory: SenderCategory;
}

export function CategoryPicker({
  senderId,
  currentCategory,
}: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const current = CATEGORY_CONFIG[currentCategory];
  const CurrentIcon = current.icon;

  function handleSelect(category: SenderCategory) {
    if (category === currentCategory) {
      setOpen(false);
      return;
    }
    setOpen(false);
    startTransition(async () => {
      await changeSenderCategory(senderId, category);
      router.refresh();
    });
  }

  function handleReject() {
    setOpen(false);
    startTransition(async () => {
      await rejectSender(senderId);
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={isPending}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-opacity hover:opacity-80",
            current.color,
          )}
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <CurrentIcon className="h-3 w-3" />
          )}
          {current.label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-0">
        <div className="py-1">
          {(["IMBOX", "FEED", "PAPER_TRAIL"] as const).map((cat) => {
            const config = CATEGORY_CONFIG[cat];
            const Icon = config.icon;
            const isActive = cat === currentCategory;
            return (
              <button
                key={cat}
                onClick={() => handleSelect(cat)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors",
                  isActive ? "bg-muted font-medium" : "hover:bg-muted/50",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", config.iconColor)} />
                <span>{config.label}</span>
                <Check
                  className={cn(
                    "ml-auto h-3 w-3",
                    isActive ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          })}
          <div className="my-1 border-t" />
          <button
            onClick={handleReject}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
          >
            <X className="h-3.5 w-3.5" />
            <span>Block sender</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
