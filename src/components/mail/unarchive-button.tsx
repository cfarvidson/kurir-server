"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore } from "lucide-react";
import { unarchiveConversation } from "@/actions/archive";
import { performOptimisticUnarchive } from "@/lib/mail/optimistic-archive";

interface UnarchiveButtonProps {
  messageId: string;
  returnPath?: string;
  threadKey?: string;
}

export function UnarchiveButton({
  messageId,
  returnPath = "/archive",
  threadKey,
}: UnarchiveButtonProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleUnarchive = () => {
    // Navigate-then-fire so the button never looks frozen behind the server
    // round-trip. The shared pending store suppresses the row in the archive
    // list until the action settles, so there is no flash-back.
    void performOptimisticUnarchive({
      messageId,
      threadKey,
      returnPath,
      queryClient,
      router,
      unarchiveConversation,
    });
  };

  return (
    <button
      onClick={handleUnarchive}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      <ArchiveRestore className="h-3.5 w-3.5" />
      Unarchive
    </button>
  );
}
