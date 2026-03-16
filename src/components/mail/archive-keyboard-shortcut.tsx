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
  const [, startTransition] = useTransition();
  const router = useRouter();

  const handleAction = useCallback(() => {
    // Tell lists to optimistically remove this message
    window.dispatchEvent(
      new CustomEvent("message-archived", { detail: { messageId } }),
    );
    // Navigate back instantly, action runs in background
    router.back();
    const actionFn = action === "unarchive" ? unarchiveConversation : archiveConversation;
    startTransition(async () => {
      await actionFn(messageId);
      router.refresh();
    });
  }, [messageId, returnPath, action, router, startTransition]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
      if (el.isContentEditable) return;
      if (e.key === "e") handleAction();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleAction]);

  return null;
}
