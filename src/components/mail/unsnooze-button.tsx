"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlarmClockOff, Loader2 } from "lucide-react";
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
  const [isPending, startTransition] = useTransition();

  const handleUnsnooze = () => {
    // Wrap in a transition so the button disables and shows a spinner the
    // instant it is pressed — without this the button looks frozen for the
    // whole server round-trip on mobile before anything happens.
    startTransition(async () => {
      await unsnoozeConversation(messageId);
      queryClient.removeQueries({ queryKey: ["messages"] });
      router.push(returnPath);
    });
  };

  return (
    <button
      onClick={handleUnsnooze}
      disabled={isPending}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <AlarmClockOff className="h-3.5 w-3.5" />
      )}
      Unsnooze
    </button>
  );
}
