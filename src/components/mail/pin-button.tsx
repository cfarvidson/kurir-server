"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pin, PinOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setPinned } from "@/actions/pin";
import { cn } from "@/lib/utils";

interface PinButtonProps {
  messageId: string;
  isPinned?: boolean;
}

/**
 * Toggle a thread's pin from the thread header (plan 056). A pin never moves
 * the thread; it adds it to /pinned and marks its row wherever it lives.
 */
export function PinButton({ messageId, isPinned }: PinButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleToggle() {
    startTransition(async () => {
      await setPinned(messageId, !isPinned);
      toast.success(isPinned ? "Unpinned" : "Pinned");
      router.refresh();
    });
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      title={isPinned ? "Unpin" : "Pin"}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-50",
        isPinned
          ? "border-primary/40 bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isPinned ? (
        <PinOff className="h-3.5 w-3.5" />
      ) : (
        <Pin className="h-3.5 w-3.5" />
      )}
      {isPinned ? "Unpin" : "Pin"}
    </button>
  );
}
