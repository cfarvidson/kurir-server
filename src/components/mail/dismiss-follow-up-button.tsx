"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { BellOff } from "lucide-react";
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
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleDismiss = () => {
    // Fire-and-forget: don't block navigation on server action
    dismissFollowUp(messageId);
    toast.success("Follow-up dismissed");
    queryClient.removeQueries({ queryKey: ["messages"] });
    router.push(returnPath);
  };

  return (
    <button
      onClick={handleDismiss}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      <BellOff className="h-3.5 w-3.5" />
      Dismiss
    </button>
  );
}
