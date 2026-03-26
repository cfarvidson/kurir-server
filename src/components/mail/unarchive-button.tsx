"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, Loader2 } from "lucide-react";
import { unarchiveConversation } from "@/actions/archive";

interface UnarchiveButtonProps {
  messageId: string;
  returnPath?: string;
}

export function UnarchiveButton({
  messageId,
  returnPath = "/archive",
}: UnarchiveButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleUnarchive = () => {
    startTransition(async () => {
      await unarchiveConversation(messageId);
      queryClient.removeQueries({ queryKey: ["messages"] });
      router.push(returnPath);
    });
  };

  return (
    <button
      onClick={handleUnarchive}
      disabled={isPending}
      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <ArchiveRestore className="h-3.5 w-3.5" />
      )}
      Unarchive
    </button>
  );
}
