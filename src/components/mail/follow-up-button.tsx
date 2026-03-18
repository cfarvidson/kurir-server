"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  setFollowUp,
  cancelFollowUp,
  dismissFollowUp,
  extendFollowUp,
} from "@/actions/follow-up";
import { FollowUpPicker } from "@/components/mail/follow-up-picker";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface FollowUpButtonProps {
  messageId: string;
  followUpAt?: Date | null;
  isFollowUp?: boolean;
}

function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 7) return `in ${diffDays} days`;
  if (diffDays < 14) return "in 1 week";
  return `in ${Math.round(diffDays / 7)} weeks`;
}

export function FollowUpButton({
  messageId,
  followUpAt,
  isFollowUp,
}: FollowUpButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const hasPendingFollowUp = !!followUpAt && !isFollowUp;
  const hasFiredFollowUp = !!isFollowUp;

  const handleSetFollowUp = (until: Date) => {
    startTransition(async () => {
      await setFollowUp(messageId, until);
      const diffDays = Math.ceil(
        (until.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
      );
      toast.success(
        `Following up ${diffDays === 1 ? "tomorrow" : `in ${diffDays} days`}`,
      );
      router.refresh();
    });
  };

  const handleCancel = () => {
    startTransition(async () => {
      await cancelFollowUp(messageId);
      toast.success("Follow-up cancelled");
      router.refresh();
    });
  };

  const handleDismiss = () => {
    startTransition(async () => {
      await dismissFollowUp(messageId);
      toast.success("Follow-up dismissed");
      router.refresh();
    });
  };

  const handleExtend = (until: Date) => {
    startTransition(async () => {
      await extendFollowUp(messageId, until);
      const diffDays = Math.ceil(
        (until.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
      );
      toast.success(`Extended to ${diffDays} day${diffDays !== 1 ? "s" : ""}`);
      router.refresh();
    });
  };

  // Fired follow-up: show dismiss/extend options
  if (hasFiredFollowUp) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Bell className="h-3.5 w-3.5" />
            )}
            Follow Up
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-0">
          <div className="py-1">
            <div className="px-3 py-2">
              <p className="text-sm font-medium">Follow-up fired</p>
            </div>
            <button
              onClick={handleDismiss}
              disabled={isPending}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
            >
              <BellOff className="h-4 w-4 text-muted-foreground" />
              <span>Dismiss</span>
            </button>
            <div className="border-t" />
            <div className="px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">
                Extend...
              </p>
            </div>
            <FollowUpPicker
              onFollowUp={handleExtend}
              isPending={isPending}
              align="end"
              trigger={
                <button
                  disabled={isPending}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  <span>Set new deadline</span>
                </button>
              }
            />
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // Pending follow-up: show active state with cancel option
  if (hasPendingFollowUp) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            disabled={isPending}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-50",
              "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100",
              "dark:border-amber-700 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900",
            )}
            title={`Following up ${formatRelativeDate(new Date(followUpAt))}`}
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Bell className="h-3.5 w-3.5" />
            )}
            {formatRelativeDate(new Date(followUpAt))}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-0">
          <div className="py-1">
            <div className="px-3 py-2">
              <p className="text-sm font-medium">
                Following up {formatRelativeDate(new Date(followUpAt))}
              </p>
            </div>
            <button
              onClick={handleCancel}
              disabled={isPending}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
            >
              <BellOff className="h-4 w-4 text-muted-foreground" />
              <span>Cancel follow-up</span>
            </button>
            <div className="border-t" />
            <div className="px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">
                Change deadline...
              </p>
            </div>
            <FollowUpPicker
              onFollowUp={handleSetFollowUp}
              isPending={isPending}
              align="end"
              trigger={
                <button
                  disabled={isPending}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  <span>Set new deadline</span>
                </button>
              }
            />
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // No follow-up: show set button with picker
  return (
    <FollowUpPicker
      onFollowUp={handleSetFollowUp}
      isPending={isPending}
      align="end"
      trigger={
        <button
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Bell className="h-3.5 w-3.5" />
          )}
          Follow Up
        </button>
      }
    />
  );
}
