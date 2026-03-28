"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore } from "lucide-react";
import { unarchiveConversation } from "@/actions/archive";

interface UnarchiveButtonProps {
  messageId: string;
  returnPath?: string;
}

export function UnarchiveButton({
  messageId,
  returnPath = "/archive",
}: UnarchiveButtonProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleUnarchive = () => {
    // Fire-and-forget: don't block navigation on server action
    unarchiveConversation(messageId);
    queryClient.removeQueries({ queryKey: ["messages"] });
    router.push(returnPath);
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
