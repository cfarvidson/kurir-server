"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Reply, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setReplyLater, clearReplyLater } from "@/actions/reply-later";
import { cn } from "@/lib/utils";

interface ReplyLaterButtonProps {
  messageId: string;
  isReplyLater?: boolean;
}

/**
 * Toggle a thread's "Reply Later" flag from the thread header. When set, the
 * thread shows up in the /reply-later focus stack.
 */
export function ReplyLaterButton({
  messageId,
  isReplyLater,
}: ReplyLaterButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleToggle() {
    startTransition(async () => {
      if (isReplyLater) {
        await clearReplyLater(messageId);
        toast.success("Removed from Reply Later");
      } else {
        await setReplyLater(messageId);
        toast.success("Added to Reply Later");
      }
      router.refresh();
    });
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      title={isReplyLater ? "Remove from Reply Later" : "Reply later"}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-50",
        isReplyLater
          ? "border-primary/40 bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Reply className="h-3.5 w-3.5" />
      )}
      Reply Later
    </button>
  );
}
