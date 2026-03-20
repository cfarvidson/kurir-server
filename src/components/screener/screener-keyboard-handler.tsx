"use client";

import { useEffect } from "react";
import { keyboardState } from "@/lib/keyboard-state";

type Category = "IMBOX" | "FEED" | "PAPER_TRAIL";

interface ScreenerKeyboardHandlerProps {
  currentSenderId: string | null;
  isProcessing: boolean;
  isCategoryPickerOpen: boolean;
  onApprove: (category?: Category) => void;
  onReject: () => void;
  onSkip: () => void;
  onTogglePreview: () => void;
  onClosePreview: () => void;
  onCloseCategoryPicker: () => void;
  onOpenCategoryPicker: () => void;
  onDismissBanner?: () => void;
  onKeyboardAction?: () => void;
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

export function ScreenerKeyboardHandler({
  currentSenderId,
  isProcessing,
  isCategoryPickerOpen,
  onApprove,
  onReject,
  onSkip,
  onTogglePreview,
  onClosePreview,
  onCloseCategoryPicker,
  onOpenCategoryPicker,
  onDismissBanner,
  onKeyboardAction,
}: ScreenerKeyboardHandlerProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isInputFocused()) return;
      if (keyboardState.gSequenceActive) return;
      if (!currentSenderId) return;
      if (isProcessing) return;

      switch (e.key) {
        case "y": {
          e.preventDefault();
          onDismissBanner?.();
          onKeyboardAction?.();
          if (isCategoryPickerOpen) {
            onApprove("IMBOX");
          } else {
            onOpenCategoryPicker();
          }
          break;
        }

        case "n": {
          e.preventDefault();
          onDismissBanner?.();
          onKeyboardAction?.();
          onReject();
          break;
        }

        case "h": {
          e.preventDefault();
          onDismissBanner?.();
          onKeyboardAction?.();
          onSkip();
          break;
        }

        case "1": {
          if (!isCategoryPickerOpen) break;
          e.preventDefault();
          onDismissBanner?.();
          onKeyboardAction?.();
          onApprove("IMBOX");
          break;
        }

        case "2": {
          if (!isCategoryPickerOpen) break;
          e.preventDefault();
          onDismissBanner?.();
          onKeyboardAction?.();
          onApprove("FEED");
          break;
        }

        case "3": {
          if (!isCategoryPickerOpen) break;
          e.preventDefault();
          onDismissBanner?.();
          onKeyboardAction?.();
          onApprove("PAPER_TRAIL");
          break;
        }

        case " ": {
          e.preventDefault();
          onDismissBanner?.();
          onKeyboardAction?.();
          onTogglePreview();
          break;
        }

        case "Escape": {
          e.preventDefault();
          onDismissBanner?.();
          // Category picker takes priority over preview
          if (isCategoryPickerOpen) {
            onCloseCategoryPicker();
          } else {
            onClosePreview();
          }
          break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    currentSenderId,
    isProcessing,
    isCategoryPickerOpen,
    onApprove,
    onReject,
    onSkip,
    onTogglePreview,
    onClosePreview,
    onCloseCategoryPicker,
    onOpenCategoryPicker,
    onDismissBanner,
    onKeyboardAction,
  ]);

  return null;
}
