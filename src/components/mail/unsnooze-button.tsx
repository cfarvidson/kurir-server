"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlarmClockOff } from "lucide-react";
import { unsnoozeConversation } from "@/actions/snooze";

interface UnsnoozeButtonProps {
  messageId: string;
  returnPath?: string;
}

export function UnsnoozeButton({
  messageId,
  returnPath = "/snoozed",
}: UnsnoozeButtonProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleUnsnooze = () => {
    // Fire-and-forget: don't block navigation on server action
    unsnoozeConversation(messageId);
    queryClient.removeQueries({ queryKey: ["messages"] });
    router.push(returnPath);
  };

  return (
    <button
      onClick={handleUnsnooze}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      <AlarmClockOff className="h-3.5 w-3.5" />
      Unsnooze
    </button>
  );
}
