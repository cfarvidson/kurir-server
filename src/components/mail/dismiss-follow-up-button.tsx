"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { dismissFollowUp } from "@/actions/follow-up";

interface DismissFollowUpButtonProps {
  messageId: string;
  returnPath?: string;
}

export function DismissFollowUpButton({
  messageId,
  returnPath = "/follow-up",
}: DismissFollowUpButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleDismiss = () => {
    startTransition(async () => {
      await dismissFollowUp(messageId);
      toast.success("Follow-up dismissed");
      router.push(returnPath);
      router.refresh();
    });
  };

  return (
    <button
      onClick={handleDismiss}
      disabled={isPending}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <BellOff className="h-3.5 w-3.5" />
      )}
      Dismiss
    </button>
  );
}
