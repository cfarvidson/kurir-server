"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { X, Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { changeSenderCategory, rejectSender } from "@/actions/senders";
import { runOptimisticSenderAction } from "@/lib/mail/optimistic-sender";
import { cn } from "@/lib/utils";
import type { SenderCategory } from "@prisma/client";

const CATEGORY_CONFIG = {
  IMBOX: { label: "Imbox", dot: "bg-imbox" },
  FEED: { label: "Feed", dot: "bg-feed" },
  PAPER_TRAIL: { label: "Paper Trail", dot: "bg-paper-trail" },
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
  const [, startTransition] = useTransition();
  const [optimisticCategory, setOptimisticCategory] =
    useState<SenderCategory>(currentCategory);
  const [blocked, setBlocked] = useState(false);
  // Guards against a second action firing before the first settles (which would
  // capture a stale `previous` and revert to the wrong category).
  const inFlight = useRef(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  // Re-anchor to the server-confirmed category once an RSC refresh delivers a
  // new prop (e.g. the sender was re-categorized from another surface). Fires
  // only after the prop actually changes, so it never clobbers an in-flight
  // optimistic value.
  useEffect(() => {
    setOptimisticCategory(currentCategory);
  }, [currentCategory]);

  const current = CATEGORY_CONFIG[optimisticCategory];

  // Reconcile lists/counts in the background without blocking the click.
  const reconcile = () => {
    inFlight.current = false;
    queryClient.invalidateQueries({ queryKey: ["messages"] });
    startTransition(() => router.refresh());
  };

  function handleSelect(category: SenderCategory) {
    setOpen(false);
    if (category === optimisticCategory || inFlight.current) return;
    inFlight.current = true;
    const previous = optimisticCategory;
    runOptimisticSenderAction({
      action: () => changeSenderCategory(senderId, category),
      applyOptimistic: () => setOptimisticCategory(category),
      revert: () => setOptimisticCategory(previous),
      reconcile,
      errorLabel: "Couldn't move sender — please try again",
    });
  }

  function handleReject() {
    setOpen(false);
    if (inFlight.current) return;
    inFlight.current = true;
    runOptimisticSenderAction({
      action: () => rejectSender(senderId),
      applyOptimistic: () => setBlocked(true),
      revert: () => setBlocked(false),
      reconcile,
      errorLabel: "Couldn't block sender — please try again",
    });
  }

  // Optimistically removed from the list when blocked.
  if (blocked) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <span
            className={cn("size-2 shrink-0 rounded-full", current.dot)}
            aria-hidden="true"
          />
          {current.label}
          <ChevronDown className="h-3 w-3 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-0">
        <div className="py-1">
          {(["IMBOX", "FEED", "PAPER_TRAIL"] as const).map((cat) => {
            const config = CATEGORY_CONFIG[cat];
            const isActive = cat === optimisticCategory;
            return (
              <button
                key={cat}
                onClick={() => handleSelect(cat)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "font-medium text-primary"
                    : "text-foreground hover:bg-muted/50",
                )}
              >
                <span
                  className={cn("size-2 shrink-0 rounded-full", config.dot)}
                  aria-hidden="true"
                />
                <span>{config.label}</span>
                <Check
                  className={cn(
                    "ml-auto h-3.5 w-3.5 text-primary",
                    isActive ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          })}
          <div className="my-1 border-t border-border" />
          <button
            onClick={handleReject}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            <X className="h-3.5 w-3.5" />
            <span>Block sender</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
