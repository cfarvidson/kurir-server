"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlarmClockOff, Loader2 } from "lucide-react";
import { unsnoozeConversation } from "@/actions/snooze";

interface UnsnoozeButtonProps {
  messageId: string;
  returnPath?: string;
}

export function UnsnoozeButton({ messageId, returnPath = "/snoozed" }: UnsnoozeButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleUnsnooze = () => {
    startTransition(async () => {
      await unsnoozeConversation(messageId);
      router.push(returnPath);
      router.refresh();
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
