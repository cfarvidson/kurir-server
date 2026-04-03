"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { snoozeConversation } from "@/actions/snooze";
import { SnoozePicker } from "@/components/mail/snooze-picker";

interface SnoozeButtonProps {
  messageId: string;
  returnPath?: string;
  timezone?: string;
}

export function SnoozeButton({
  messageId,
  returnPath = "/imbox",
  timezone = "UTC",
}: SnoozeButtonProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleSnooze = async (until: Date) => {
    await snoozeConversation(messageId, until);
    queryClient.removeQueries({ queryKey: ["messages"] });
    router.push(returnPath);
  };

  return (
    <SnoozePicker
      onSnooze={handleSnooze}
      timezone={timezone}
      align="end"
      trigger={
        <button className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 md:px-3">
          <Clock className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Snooze</span>
          <kbd className="hidden h-[18px] min-w-[18px] items-center justify-center rounded border border-border/50 bg-muted/30 px-1 font-mono text-[10px] text-muted-foreground/50 lg:inline-flex">
            S
          </kbd>
        </button>
      }
    />
  );
}
