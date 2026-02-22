"use client";

import { useTransition } from "react";
import { Archive, Clock, Loader2, X } from "lucide-react";
import { archiveConversations } from "@/actions/archive";
import { snoozeConversations } from "@/actions/snooze";
import { SnoozePicker } from "@/components/mail/snooze-picker";

interface SelectionActionBarProps {
  selectedMessageIds: string[];
  onComplete: () => void;
  onQueryInvalidate: () => void;
  showSnoozeAction?: boolean;
}

export function SelectionActionBar({
  selectedMessageIds,
  onComplete,
  onQueryInvalidate,
  showSnoozeAction = false,
}: SelectionActionBarProps) {
  const [isPending, startTransition] = useTransition();
  const count = selectedMessageIds.length;

  if (count === 0) return null;

  const handleArchive = () => {
    startTransition(async () => {
      await archiveConversations(selectedMessageIds);
      onComplete();
      onQueryInvalidate();
    });
  };

  const handleSnooze = (until: Date) => {
    startTransition(async () => {
      await snoozeConversations(selectedMessageIds, until);
      onComplete();
      onQueryInvalidate();
    });
  };

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-xl border bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <span className="text-sm tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">{count}</span>{" "}
          {count === 1 ? "conversation" : "conversations"} selected
        </span>
        {showSnoozeAction && (
          <SnoozePicker
            onSnooze={handleSnooze}
            isPending={isPending}
            side="top"
            align="center"
            trigger={
              <button
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Clock className="h-4 w-4" />
                )}
                Snooze
              </button>
            }
          />
        )}
        <button
          onClick={handleArchive}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Archive className="h-4 w-4" />
          )}
          Archive
        </button>
        <button
          onClick={onComplete}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Cancel selection"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
