"use client";

import { useEffect, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { archiveConversation, unarchiveConversation } from "@/actions/archive";
import { showUndoToast } from "@/components/mail/undo-toast";

interface ArchiveKeyboardShortcutProps {
  messageId: string;
  returnPath: string;
  action?: "archive" | "unarchive";
}

export function ArchiveKeyboardShortcut({
  messageId,
  returnPath,
  action = "archive",
}: ArchiveKeyboardShortcutProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleAction = useCallback(() => {
    if (action === "archive") {
      showUndoToast({
        id: `archive-${messageId}`,
        label: "Archived",
        onUndo: () => {
          unarchiveConversation(messageId).then(() => router.refresh());
        },
      });
    }

    startTransition(async () => {
      if (action === "unarchive") {
        await unarchiveConversation(messageId);
      } else {
        await archiveConversation(messageId, returnPath);
      }
      queryClient.removeQueries({ queryKey: ["messages"] });
      router.push(returnPath);
    });
  }, [messageId, returnPath, action, router, queryClient, startTransition]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
      if (el.isContentEditable) return;
      if (e.key === "e" && !isPending) handleAction();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleAction, isPending]);

  return null;
}
