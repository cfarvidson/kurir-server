"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useKeyboardNavigationStore } from "@/stores/keyboard-navigation-store";
import { keyboardState } from "@/lib/keyboard-state";
import { archiveConversation } from "@/actions/archive";
import { toggleReadStatus } from "@/actions/read-status";
import type { MessageItem } from "@/components/mail/message-list";

interface ListKeyboardHandlerProps {
  threads: MessageItem[];
  basePath: string;
  onArchived?: (messageId?: string) => void;
  onToggleSelect?: (threadKey: string) => void;
  showSnoozeAction?: boolean;
}

function isInputFocused() {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

function scrollFocusedIntoView() {
  requestAnimationFrame(() => {
    const el = document.querySelector('[data-keyboard-focused="true"]');
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

export function ListKeyboardHandler({
  threads,
  basePath,
  onArchived,
  onToggleSelect,
  showSnoozeAction,
}: ListKeyboardHandlerProps) {
  const router = useRouter();
  const { focusedIndex, moveFocus, setFocusedIndex } =
    useKeyboardNavigationStore();

  const getFocusedMessage = useCallback((): MessageItem | null => {
    if (focusedIndex < 0 || focusedIndex >= threads.length) return null;
    return threads[focusedIndex];
  }, [focusedIndex, threads]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isInputFocused()) return;
      if (keyboardState.gSequenceActive) return;

      const msg = getFocusedMessage();

      switch (e.key) {
        case "j": {
          e.preventDefault();
          moveFocus(1, threads.length);
          scrollFocusedIntoView();
          break;
        }

        case "k": {
          e.preventDefault();
          moveFocus(-1, threads.length);
          scrollFocusedIntoView();
          break;
        }

        case "Enter":
        case "o": {
          if (!msg) break;
          e.preventDefault();
          router.push(`${basePath}/${msg.id}`);
          break;
        }

        case "e": {
          if (!msg) break;
          e.preventDefault();
          onArchived?.(msg.id);
          archiveConversation(msg.id, basePath).then(() => {
            router.refresh();
          });
          // Move focus to next row (or previous if at end)
          if (focusedIndex >= threads.length - 1 && focusedIndex > 0) {
            setFocusedIndex(focusedIndex - 1);
          }
          break;
        }

        case "s": {
          if (!msg || !showSnoozeAction) break;
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent("keyboard-snooze", {
              detail: { messageId: msg.id },
            }),
          );
          break;
        }

        case "x": {
          if (!msg) break;
          e.preventDefault();
          const threadKey = msg.threadId || msg.id;
          onToggleSelect?.(threadKey);
          break;
        }

        case "U": {
          // Shift+U
          if (!e.shiftKey || !msg) break;
          e.preventDefault();
          toggleReadStatus(msg.id).then(() => {
            router.refresh();
          });
          break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    threads,
    basePath,
    focusedIndex,
    getFocusedMessage,
    moveFocus,
    setFocusedIndex,
    onArchived,
    onToggleSelect,
    showSnoozeAction,
    router,
  ]);

  return null;
}
