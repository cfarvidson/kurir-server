"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2 } from "lucide-react";
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
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleSnooze = (until: Date) => {
    startTransition(async () => {
      await snoozeConversation(messageId, until);
      queryClient.removeQueries({ queryKey: ["messages"] });
      router.push(returnPath);
    });
  };

  return (
    <SnoozePicker
      onSnooze={handleSnooze}
      isPending={isPending}
      timezone={timezone}
      align="end"
      trigger={
        <button
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 md:px-3"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Clock className="h-3.5 w-3.5" />
          )}
          <span className="hidden md:inline">Snooze</span>
        </button>
      }
    />
  );
}
