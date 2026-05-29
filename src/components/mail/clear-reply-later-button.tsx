"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { clearReplyLater } from "@/actions/reply-later";

interface ClearReplyLaterButtonProps {
  messageId: string;
  returnPath?: string;
}

/** "Done" action for the Reply Later detail view — clears the flag and returns. */
export function ClearReplyLaterButton({
  messageId,
  returnPath = "/reply-later",
}: ClearReplyLaterButtonProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();

  function handleDone() {
    startTransition(async () => {
      await clearReplyLater(messageId);
      toast.success("Cleared from Reply Later");
      queryClient.removeQueries({ queryKey: ["messages"] });
      router.push(returnPath);
    });
  }

  return (
    <button
      onClick={handleDone}
      disabled={isPending}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Check className="h-3.5 w-3.5" />
      )}
      Done
    </button>
  );
}
