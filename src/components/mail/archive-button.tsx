"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import { archiveConversation, unarchiveConversation } from "@/actions/archive";
import { showUndoToast } from "@/components/mail/undo-toast";

interface ArchiveButtonProps {
  messageId: string;
  returnPath?: string;
}

export function ArchiveButton({
  messageId,
  returnPath = "/imbox",
}: ArchiveButtonProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleArchive = async () => {
    showUndoToast({
      id: `archive-${messageId}`,
      label: "Archived",
      onUndo: () => {
        unarchiveConversation(messageId).then(() => router.refresh());
      },
    });

    await archiveConversation(messageId, returnPath);
    queryClient.removeQueries({ queryKey: ["messages"] });
    router.push(returnPath);
  };

  return (
    <button
      onClick={handleArchive}
      className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 md:px-3"
    >
      <Archive className="h-3.5 w-3.5" />
      <span className="hidden md:inline">Archive</span>
      <kbd className="hidden h-[18px] min-w-[18px] items-center justify-center rounded border border-border/50 bg-muted/30 px-1 font-mono text-[10px] text-muted-foreground/50 lg:inline-flex">
        E
      </kbd>
    </button>
  );
}
