"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useKeyboardNavigationStore } from "@/stores/keyboard-navigation-store";
import { keyboardState } from "@/lib/keyboard-state";

interface ThreadKeyboardHandlerProps {
  messageId: string;
  returnPath: string;
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

export function ThreadKeyboardHandler({
  messageId,
  returnPath,
}: ThreadKeyboardHandlerProps) {
  const router = useRouter();
  const { threadIds, basePath, setFocusedIndex } =
    useKeyboardNavigationStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isInputFocused()) return;
      if (keyboardState.gSequenceActive) return;

      switch (e.key) {
        case "r": {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("keyboard-reply"));
          break;
        }

        case "j": {
          // Next thread
          e.preventDefault();
          const currentIndex = threadIds.indexOf(messageId);
          if (currentIndex === -1 || currentIndex >= threadIds.length - 1)
            break;
          const nextId = threadIds[currentIndex + 1];
          setFocusedIndex(currentIndex + 1);
          router.push(`${basePath}/${nextId}`);
          break;
        }

        case "k": {
          // Previous thread
          e.preventDefault();
          const idx = threadIds.indexOf(messageId);
          if (idx <= 0) break;
          const prevId = threadIds[idx - 1];
          setFocusedIndex(idx - 1);
          router.push(`${basePath}/${prevId}`);
          break;
        }

        case "Escape": {
          e.preventDefault();
          // Restore focus to the thread we were viewing
          const viewIndex = threadIds.indexOf(messageId);
          if (viewIndex !== -1) setFocusedIndex(viewIndex);
          router.push(returnPath);
          break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [messageId, returnPath, threadIds, basePath, setFocusedIndex, router]);

  return null;
}
