"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Loader2 } from "lucide-react";
import { archiveConversation } from "@/actions/archive";

interface ArchiveButtonProps {
  messageId: string;
  returnPath?: string;
}

export function ArchiveButton({ messageId, returnPath = "/imbox" }: ArchiveButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleArchive = () => {
    // Navigate with hint to hide this message, fire action in parallel
    const sep = returnPath.includes("?") ? "&" : "?";
    router.push(`${returnPath}${sep}archived=${messageId}`);
    startTransition(() => {
      archiveConversation(messageId);
    });
  };

  return (
    <button
      onClick={handleArchive}
      disabled={isPending}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Archive className="h-3.5 w-3.5" />
      )}
      Archive
    </button>
  );
}
