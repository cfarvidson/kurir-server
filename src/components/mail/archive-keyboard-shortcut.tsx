"use client";

import { useEffect, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { archiveConversation, unarchiveConversation } from "@/actions/archive";

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

  const handleAction = useCallback(() => {
    startTransition(async () => {
      if (action === "unarchive") {
        await unarchiveConversation(messageId);
      } else {
        await archiveConversation(messageId, returnPath);
      }
      router.push(returnPath);
    });
  }, [messageId, returnPath, action, router, startTransition]);

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
