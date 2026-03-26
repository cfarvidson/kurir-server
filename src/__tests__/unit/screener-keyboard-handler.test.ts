import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { keyboardState } from "@/lib/keyboard-state";

/**
 * Unit tests for ScreenerKeyboardHandler logic.
 *
 * The handler is a renderless component that attaches a window.keydown listener.
 * We test the pure handler logic by extracting it into a testable function
 * mirroring the implementation spec from designs/screener-keyboard-ux-spec.md.
 */

// ─── Mirrored implementation (matches the spec) ──────────────────────────────

type Category = "IMBOX" | "FEED" | "PAPER_TRAIL";

interface ScreenerHandlerOptions {
  currentSenderId: string | null;
  onApprove: (category?: Category) => void;
  onReject: () => void;
  onSkip: () => void;
  onTogglePreview: () => void;
  onClosePreview: () => void;
  isPreviewOpen: boolean;
  isCategoryPickerOpen: boolean;
  onOpenCategoryPicker: () => void;
  onCloseCategoryPicker: () => void;
  onDismissBanner?: () => void;
  isProcessing?: boolean;
}

function isInputFocused(activeTagName: string, isContentEditable: boolean) {
  return (
    activeTagName === "INPUT" ||
    activeTagName === "TEXTAREA" ||
    activeTagName === "SELECT" ||
    isContentEditable
  );
}

/**
 * Pure handler function mirroring ScreenerKeyboardHandler's keydown logic.
 * Returns true if the event was handled, false if ignored.
 */
function handleScreenerKey(
  key: string,
  opts: ScreenerHandlerOptions,
  activeTagName = "BODY",
  isContentEditable = false,
  preventDefault = vi.fn(),
): boolean {
  if (isInputFocused(activeTagName, isContentEditable)) return false;
  if (keyboardState.gSequenceActive) return false;
  if (!opts.currentSenderId) return false;
  if (opts.isProcessing) return false;

  switch (key) {
    case "y": {
      preventDefault();
      opts.onDismissBanner?.();
      if (opts.isCategoryPickerOpen) {
        opts.onApprove("IMBOX");
      } else {
        opts.onOpenCategoryPicker();
      }
      return true;
    }
    case "n": {
      preventDefault();
      opts.onDismissBanner?.();
      opts.onReject();
      return true;
    }
    case "h": {
      preventDefault();
      opts.onDismissBanner?.();
      opts.onSkip();
      return true;
    }
    case "1": {
      if (!opts.isCategoryPickerOpen) return false;
      preventDefault();
      opts.onDismissBanner?.();
      opts.onApprove("IMBOX");
      return true;
    }
    case "2": {
      if (!opts.isCategoryPickerOpen) return false;
      preventDefault();
      opts.onDismissBanner?.();
      opts.onApprove("FEED");
      return true;
    }
    case "3": {
      if (!opts.isCategoryPickerOpen) return false;
      preventDefault();
      opts.onDismissBanner?.();
      opts.onApprove("PAPER_TRAIL");
      return true;
    }
    case " ": {
      preventDefault();
      opts.onDismissBanner?.();
      opts.onTogglePreview();
      return true;
    }
    case "Escape": {
      if (opts.isCategoryPickerOpen) {
        preventDefault();
        opts.onCloseCategoryPicker();
        return true;
      }
      if (opts.isPreviewOpen) {
        preventDefault();
        opts.onClosePreview();
        return true;
      }
      return false;
    }
    default:
      return false;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ScreenerKeyboardHandler", () => {
  let opts: ScreenerHandlerOptions;

  beforeEach(() => {
    keyboardState.gSequenceActive = false;

    opts = {
      currentSenderId: "sender-1",
      onApprove: vi.fn(),
      onReject: vi.fn(),
      onSkip: vi.fn(),
      onTogglePreview: vi.fn(),
      onClosePreview: vi.fn(),
      isPreviewOpen: false,
      isCategoryPickerOpen: false,
      onOpenCategoryPicker: vi.fn(),
      onCloseCategoryPicker: vi.fn(),
      onDismissBanner: vi.fn(),
      isProcessing: false,
    };
  });

  afterEach(() => {
    keyboardState.gSequenceActive = false;
  });

  // ── y key ──────────────────────────────────────────────────────────────────

  describe("y key — screen in", () => {
    it("opens category picker when picker is closed", () => {
      handleScreenerKey("y", opts);
      expect(opts.onOpenCategoryPicker).toHaveBeenCalledOnce();
      expect(opts.onApprove).not.toHaveBeenCalled();
    });

    it("approves with IMBOX when category picker is already open", () => {
      opts.isCategoryPickerOpen = true;
      handleScreenerKey("y", opts);
      expect(opts.onApprove).toHaveBeenCalledWith("IMBOX");
      expect(opts.onOpenCategoryPicker).not.toHaveBeenCalled();
    });

    it("dismisses the hint banner", () => {
      handleScreenerKey("y", opts);
      expect(opts.onDismissBanner).toHaveBeenCalledOnce();
    });
  });

  // ── n key ──────────────────────────────────────────────────────────────────

  describe("n key — screen out", () => {
    it("calls onReject", () => {
      handleScreenerKey("n", opts);
      expect(opts.onReject).toHaveBeenCalledOnce();
    });

    it("dismisses the hint banner", () => {
      handleScreenerKey("n", opts);
      expect(opts.onDismissBanner).toHaveBeenCalledOnce();
    });

    it("does not open category picker", () => {
      handleScreenerKey("n", opts);
      expect(opts.onOpenCategoryPicker).not.toHaveBeenCalled();
    });
  });

  // ── h key ──────────────────────────────────────────────────────────────────

  describe("h key — skip", () => {
    it("calls onSkip", () => {
      handleScreenerKey("h", opts);
      expect(opts.onSkip).toHaveBeenCalledOnce();
    });

    it("dismisses the hint banner", () => {
      handleScreenerKey("h", opts);
      expect(opts.onDismissBanner).toHaveBeenCalledOnce();
    });
  });

  // ── number keys ───────────────────────────────────────────────────────────

  describe("number keys — category selection", () => {
    it("1 approves with IMBOX when picker is open", () => {
      opts.isCategoryPickerOpen = true;
      handleScreenerKey("1", opts);
      expect(opts.onApprove).toHaveBeenCalledWith("IMBOX");
    });

    it("2 approves with FEED when picker is open", () => {
      opts.isCategoryPickerOpen = true;
      handleScreenerKey("2", opts);
      expect(opts.onApprove).toHaveBeenCalledWith("FEED");
    });

    it("3 approves with PAPER_TRAIL when picker is open", () => {
      opts.isCategoryPickerOpen = true;
      handleScreenerKey("3", opts);
      expect(opts.onApprove).toHaveBeenCalledWith("PAPER_TRAIL");
    });

    it("1 does nothing when category picker is closed", () => {
      opts.isCategoryPickerOpen = false;
      const handled = handleScreenerKey("1", opts);
      expect(handled).toBe(false);
      expect(opts.onApprove).not.toHaveBeenCalled();
    });

    it("2 does nothing when category picker is closed", () => {
      opts.isCategoryPickerOpen = false;
      const handled = handleScreenerKey("2", opts);
      expect(handled).toBe(false);
      expect(opts.onApprove).not.toHaveBeenCalled();
    });

    it("3 does nothing when category picker is closed", () => {
      opts.isCategoryPickerOpen = false;
      const handled = handleScreenerKey("3", opts);
      expect(handled).toBe(false);
      expect(opts.onApprove).not.toHaveBeenCalled();
    });

    it("dismisses banner when 1 is used with picker open", () => {
      opts.isCategoryPickerOpen = true;
      handleScreenerKey("1", opts);
      expect(opts.onDismissBanner).toHaveBeenCalledOnce();
    });
  });

  // ── Space key ─────────────────────────────────────────────────────────────

  describe("Space key — toggle preview", () => {
    it("calls onTogglePreview", () => {
      handleScreenerKey(" ", opts);
      expect(opts.onTogglePreview).toHaveBeenCalledOnce();
    });

    it("dismisses the hint banner", () => {
      handleScreenerKey(" ", opts);
      expect(opts.onDismissBanner).toHaveBeenCalledOnce();
    });

    it("toggles preview even when category picker is open", () => {
      opts.isCategoryPickerOpen = true;
      handleScreenerKey(" ", opts);
      expect(opts.onTogglePreview).toHaveBeenCalledOnce();
    });
  });

  // ── Escape key ────────────────────────────────────────────────────────────

  describe("Escape key — close states", () => {
    it("closes category picker first when both are open", () => {
      opts.isCategoryPickerOpen = true;
      opts.isPreviewOpen = true;
      handleScreenerKey("Escape", opts);
      expect(opts.onCloseCategoryPicker).toHaveBeenCalledOnce();
      expect(opts.onClosePreview).not.toHaveBeenCalled();
    });

    it("closes only preview when picker is closed and preview is open", () => {
      opts.isCategoryPickerOpen = false;
      opts.isPreviewOpen = true;
      handleScreenerKey("Escape", opts);
      expect(opts.onClosePreview).toHaveBeenCalledOnce();
      expect(opts.onCloseCategoryPicker).not.toHaveBeenCalled();
    });

    it("second Escape closes preview after first Escape closed the picker", () => {
      opts.isCategoryPickerOpen = true;
      opts.isPreviewOpen = true;

      // First Escape: closes picker
      handleScreenerKey("Escape", opts);
      expect(opts.onCloseCategoryPicker).toHaveBeenCalledOnce();

      // Simulate state after first Escape
      opts.isCategoryPickerOpen = false;
      // Second Escape: closes preview
      handleScreenerKey("Escape", opts);
      expect(opts.onClosePreview).toHaveBeenCalledOnce();
    });

    it("does nothing when both are closed", () => {
      opts.isCategoryPickerOpen = false;
      opts.isPreviewOpen = false;
      const handled = handleScreenerKey("Escape", opts);
      expect(handled).toBe(false);
      expect(opts.onCloseCategoryPicker).not.toHaveBeenCalled();
      expect(opts.onClosePreview).not.toHaveBeenCalled();
    });

    it("closes category picker alone when picker is open and preview is closed", () => {
      opts.isCategoryPickerOpen = true;
      opts.isPreviewOpen = false;
      handleScreenerKey("Escape", opts);
      expect(opts.onCloseCategoryPicker).toHaveBeenCalledOnce();
      expect(opts.onClosePreview).not.toHaveBeenCalled();
    });
  });

  // ── Input-focused guard ───────────────────────────────────────────────────

  describe("shortcuts ignored when input is focused", () => {
    const inputCases: [string, boolean][] = [
      ["INPUT", false],
      ["TEXTAREA", false],
      ["SELECT", false],
      ["DIV", true], // contentEditable
    ];

    for (const [tagName, isContentEditable] of inputCases) {
      it(`ignores y shortcut when ${tagName}${isContentEditable ? " (contentEditable)" : ""} is focused`, () => {
        const handled = handleScreenerKey(
          "y",
          opts,
          tagName,
          isContentEditable,
        );
        expect(handled).toBe(false);
        expect(opts.onOpenCategoryPicker).not.toHaveBeenCalled();
      });

      it(`ignores n shortcut when ${tagName}${isContentEditable ? " (contentEditable)" : ""} is focused`, () => {
        const handled = handleScreenerKey(
          "n",
          opts,
          tagName,
          isContentEditable,
        );
        expect(handled).toBe(false);
        expect(opts.onReject).not.toHaveBeenCalled();
      });

      it(`ignores Space shortcut when ${tagName}${isContentEditable ? " (contentEditable)" : ""} is focused`, () => {
        const handled = handleScreenerKey(
          " ",
          opts,
          tagName,
          isContentEditable,
        );
        expect(handled).toBe(false);
        expect(opts.onTogglePreview).not.toHaveBeenCalled();
      });
    }
  });

  // ── gSequenceActive guard ─────────────────────────────────────────────────

  describe("shortcuts ignored during g-sequence", () => {
    it("ignores y when gSequenceActive is true", () => {
      keyboardState.gSequenceActive = true;
      const handled = handleScreenerKey("y", opts);
      expect(handled).toBe(false);
      expect(opts.onOpenCategoryPicker).not.toHaveBeenCalled();
    });

    it("ignores n when gSequenceActive is true", () => {
      keyboardState.gSequenceActive = true;
      const handled = handleScreenerKey("n", opts);
      expect(handled).toBe(false);
      expect(opts.onReject).not.toHaveBeenCalled();
    });

    it("ignores Space when gSequenceActive is true", () => {
      keyboardState.gSequenceActive = true;
      const handled = handleScreenerKey(" ", opts);
      expect(handled).toBe(false);
      expect(opts.onTogglePreview).not.toHaveBeenCalled();
    });
  });

  // ── isProcessing guard ────────────────────────────────────────────────────

  describe("shortcuts ignored when action is processing", () => {
    it("ignores y when isProcessing is true", () => {
      opts.isProcessing = true;
      const handled = handleScreenerKey("y", opts);
      expect(handled).toBe(false);
      expect(opts.onOpenCategoryPicker).not.toHaveBeenCalled();
    });

    it("ignores n when isProcessing is true", () => {
      opts.isProcessing = true;
      const handled = handleScreenerKey("n", opts);
      expect(handled).toBe(false);
      expect(opts.onReject).not.toHaveBeenCalled();
    });
  });

  // ── No current sender ────────────────────────────────────────────────────

  describe("shortcuts ignored when no current sender", () => {
    it("ignores all shortcuts when currentSenderId is null", () => {
      opts.currentSenderId = null;
      expect(handleScreenerKey("y", opts)).toBe(false);
      expect(handleScreenerKey("n", opts)).toBe(false);
      expect(handleScreenerKey("h", opts)).toBe(false);
      expect(handleScreenerKey(" ", opts)).toBe(false);
      expect(
        handleScreenerKey("Escape", { ...opts, isPreviewOpen: true }),
      ).toBe(false);
    });
  });

  // ── No-op banner dismiss when undefined ──────────────────────────────────

  describe("graceful handling when onDismissBanner not provided", () => {
    it("does not throw when onDismissBanner is undefined", () => {
      delete (opts as Partial<ScreenerHandlerOptions>).onDismissBanner;
      expect(() => handleScreenerKey("y", opts)).not.toThrow();
      expect(opts.onOpenCategoryPicker).toHaveBeenCalledOnce();
    });
  });
});
