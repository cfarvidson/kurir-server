"use client";

import { useEffect, useCallback, useRef } from "react";
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const actingRef = useRef(false);

  const handleAction = useCallback(() => {
    if (actingRef.current) return;
    actingRef.current = true;

    if (action === "archive") {
      showUndoToast({
        id: `archive-${messageId}`,
        label: "Archived",
        onUndo: () => {
          unarchiveConversation(messageId).then(() => router.refresh());
        },
      });
    }

    // Fire-and-forget: don't block navigation on server action
    if (action === "unarchive") {
      unarchiveConversation(messageId);
    } else {
      archiveConversation(messageId, returnPath);
    }
    queryClient.removeQueries({ queryKey: ["messages"] });
    router.push(returnPath);
  }, [messageId, returnPath, action, router, queryClient]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT"
      )
        return;
      if (el.isContentEditable) return;
      if (e.key === "e") handleAction();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleAction]);

  return null;
}
