"use client";

import { useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { archiveConversation, unarchiveConversation } from "@/actions/archive";
import {
  performOptimisticArchive,
  performOptimisticUnarchive,
} from "@/lib/mail/optimistic-archive";

interface ArchiveKeyboardShortcutProps {
  messageId: string;
  returnPath: string;
  threadKey?: string;
  action?: "archive" | "unarchive";
}

export function ArchiveKeyboardShortcut({
  messageId,
  returnPath,
  threadKey,
  action = "archive",
}: ArchiveKeyboardShortcutProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const actingRef = useRef(false);

  const handleAction = useCallback(() => {
    if (actingRef.current) return;
    actingRef.current = true;

    const settled =
      action === "unarchive"
        ? performOptimisticUnarchive({
            messageId,
            threadKey,
            returnPath,
            queryClient,
            router,
            unarchiveConversation,
          })
        : performOptimisticArchive({
            messageId,
            threadKey,
            returnPath,
            queryClient,
            router,
            archiveConversation,
            unarchiveConversation,
          });

    // Re-arm once the sequence settles — the handler no longer awaits, so the
    // guard would otherwise stay latched forever if the component survives
    // navigation (e.g. shared layout slot).
    settled.finally(() => {
      actingRef.current = false;
    });
  }, [messageId, returnPath, threadKey, action, router, queryClient]);

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
