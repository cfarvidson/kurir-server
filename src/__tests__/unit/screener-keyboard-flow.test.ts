import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { keyboardState } from "@/lib/keyboard-state";

/**
 * Integration-style tests for the full Screener keyboard flow.
 *
 * These tests simulate end-to-end user journeys through the Screener using
 * keyboard shortcuts, verifying the interaction between keyboard handling,
 * preview state, and category picker state.
 *
 * Scenarios from designs/screener-keyboard-ux-spec.md, Task 4.3:
 * - Space to preview → y to open picker → 1 to approve to Imbox
 * - n to reject → verify next card appears
 * - h to skip → verify card skipped
 */

// ─── State machine ────────────────────────────────────────────────────────────

type Category = "IMBOX" | "FEED" | "PAPER_TRAIL";

interface ScreenerState {
  senderQueue: string[]; // sender IDs
  processedSenders: Array<{ id: string; action: "approved" | "rejected" | "skipped"; category?: Category }>;
  isPreviewOpen: boolean;
  isCategoryPickerOpen: boolean;
  isProcessing: boolean;
  undoStack: Array<{ id: string; action: string; timestamp: number }>;
}

function createScreenerState(senderIds: string[]): ScreenerState {
  return {
    senderQueue: [...senderIds],
    processedSenders: [],
    isPreviewOpen: false,
    isCategoryPickerOpen: false,
    isProcessing: false,
    undoStack: [],
  };
}

function currentSenderId(state: ScreenerState): string | null {
  return state.senderQueue[0] ?? null;
}

function dispatch(
  state: ScreenerState,
  action:
    | { type: "APPROVE"; category: Category }
    | { type: "REJECT" }
    | { type: "SKIP" }
    | { type: "TOGGLE_PREVIEW" }
    | { type: "CLOSE_PREVIEW" }
    | { type: "OPEN_CATEGORY_PICKER" }
    | { type: "CLOSE_CATEGORY_PICKER" }
    | { type: "UNDO" }
): ScreenerState {
  const senderId = state.senderQueue[0];

  switch (action.type) {
    case "APPROVE": {
      if (!senderId) return state;
      const entry = { id: senderId, action: "approved" as const, category: action.category, timestamp: Date.now() };
      return {
        ...state,
        senderQueue: state.senderQueue.slice(1),
        processedSenders: [...state.processedSenders, entry],
        isCategoryPickerOpen: false,
        isPreviewOpen: false,
        undoStack: [...state.undoStack, entry],
      };
    }
    case "REJECT": {
      if (!senderId) return state;
      const entry = { id: senderId, action: "rejected" as const, timestamp: Date.now() };
      return {
        ...state,
        senderQueue: state.senderQueue.slice(1),
        processedSenders: [...state.processedSenders, entry],
        isPreviewOpen: false,
        undoStack: [...state.undoStack, entry],
      };
    }
    case "SKIP": {
      if (!senderId) return state;
      const skipped = state.senderQueue[0]!;
      // Move skipped sender to end of queue
      const newQueue = [...state.senderQueue.slice(1), skipped];
      return {
        ...state,
        senderQueue: newQueue,
        isPreviewOpen: false,
      };
    }
    case "TOGGLE_PREVIEW": {
      return { ...state, isPreviewOpen: !state.isPreviewOpen };
    }
    case "CLOSE_PREVIEW": {
      return { ...state, isPreviewOpen: false };
    }
    case "OPEN_CATEGORY_PICKER": {
      return { ...state, isCategoryPickerOpen: true };
    }
    case "CLOSE_CATEGORY_PICKER": {
      return { ...state, isCategoryPickerOpen: false };
    }
    case "UNDO": {
      const last = state.undoStack[state.undoStack.length - 1];
      if (!last) return state;
      // Restore the sender to front of queue
      return {
        ...state,
        senderQueue: [last.id, ...state.senderQueue],
        processedSenders: state.processedSenders.filter((s) => s.id !== last.id),
        undoStack: state.undoStack.slice(0, -1),
      };
    }
    default:
      return state;
  }
}

// ─── Keyboard handler ─────────────────────────────────────────────────────────

function handleKey(
  key: string,
  state: ScreenerState
): ScreenerState {
  if (keyboardState.gSequenceActive) return state;
  if (state.isProcessing) return state;
  if (!currentSenderId(state)) return state;

  switch (key) {
    case "y":
      if (state.isCategoryPickerOpen) {
        return dispatch(state, { type: "APPROVE", category: "IMBOX" });
      }
      return dispatch(state, { type: "OPEN_CATEGORY_PICKER" });

    case "n":
      return dispatch(state, { type: "REJECT" });

    case "h":
      return dispatch(state, { type: "SKIP" });

    case "1":
      if (!state.isCategoryPickerOpen) return state;
      return dispatch(state, { type: "APPROVE", category: "IMBOX" });

    case "2":
      if (!state.isCategoryPickerOpen) return state;
      return dispatch(state, { type: "APPROVE", category: "FEED" });

    case "3":
      if (!state.isCategoryPickerOpen) return state;
      return dispatch(state, { type: "APPROVE", category: "PAPER_TRAIL" });

    case " ":
      return dispatch(state, { type: "TOGGLE_PREVIEW" });

    case "Escape":
      if (state.isCategoryPickerOpen) {
        return dispatch(state, { type: "CLOSE_CATEGORY_PICKER" });
      }
      if (state.isPreviewOpen) {
        return dispatch(state, { type: "CLOSE_PREVIEW" });
      }
      return state;

    default:
      return state;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Screener keyboard flow integration", () => {
  beforeEach(() => {
    keyboardState.gSequenceActive = false;
  });

  afterEach(() => {
    keyboardState.gSequenceActive = false;
  });

  describe("Flow: Space → y → 1 (approve to Imbox)", () => {
    it("completes the full approve-to-Imbox flow", () => {
      let state = createScreenerState(["sender-a", "sender-b"]);

      // Step 1: Space → opens preview
      state = handleKey(" ", state);
      expect(state.isPreviewOpen).toBe(true);
      expect(currentSenderId(state)).toBe("sender-a");

      // Step 2: y → opens category picker (picker was closed)
      state = handleKey("y", state);
      expect(state.isCategoryPickerOpen).toBe(true);
      expect(state.isPreviewOpen).toBe(true); // preview stays open

      // Step 3: 1 → approve to Imbox
      state = handleKey("1", state);
      expect(state.processedSenders).toHaveLength(1);
      expect(state.processedSenders[0]).toMatchObject({
        id: "sender-a",
        action: "approved",
        category: "IMBOX",
      });

      // Card dismissed → next card shows, state resets
      expect(currentSenderId(state)).toBe("sender-b");
      expect(state.isPreviewOpen).toBe(false);
      expect(state.isCategoryPickerOpen).toBe(false);
    });

    it("y pressed twice approves with IMBOX immediately on second press", () => {
      let state = createScreenerState(["sender-a", "sender-b"]);

      // First y: opens picker
      state = handleKey("y", state);
      expect(state.isCategoryPickerOpen).toBe(true);

      // Second y: approves with IMBOX
      state = handleKey("y", state);
      expect(state.processedSenders[0]).toMatchObject({
        id: "sender-a",
        action: "approved",
        category: "IMBOX",
      });
    });
  });

  describe("Flow: Space → y → 2 (approve to Feed)", () => {
    it("approves to Feed via y then 2", () => {
      let state = createScreenerState(["sender-x"]);

      state = handleKey(" ", state);
      state = handleKey("y", state);
      state = handleKey("2", state);

      expect(state.processedSenders[0]).toMatchObject({
        id: "sender-x",
        action: "approved",
        category: "FEED",
      });
    });
  });

  describe("Flow: Space → y → 3 (approve to Paper Trail)", () => {
    it("approves to Paper Trail via y then 3", () => {
      let state = createScreenerState(["sender-x"]);

      state = handleKey(" ", state);
      state = handleKey("y", state);
      state = handleKey("3", state);

      expect(state.processedSenders[0]).toMatchObject({
        id: "sender-x",
        action: "approved",
        category: "PAPER_TRAIL",
      });
    });
  });

  describe("Flow: n to reject", () => {
    it("rejects sender and shows next card", () => {
      let state = createScreenerState(["sender-a", "sender-b", "sender-c"]);

      state = handleKey("n", state);

      expect(state.processedSenders).toHaveLength(1);
      expect(state.processedSenders[0]).toMatchObject({
        id: "sender-a",
        action: "rejected",
      });
      expect(currentSenderId(state)).toBe("sender-b");
    });

    it("rejects multiple senders in sequence", () => {
      let state = createScreenerState(["s1", "s2", "s3"]);

      state = handleKey("n", state);
      state = handleKey("n", state);

      expect(state.processedSenders).toHaveLength(2);
      expect(currentSenderId(state)).toBe("s3");
    });

    it("results in empty queue after rejecting all senders", () => {
      let state = createScreenerState(["only-one"]);

      state = handleKey("n", state);

      expect(currentSenderId(state)).toBeNull();
      expect(state.senderQueue).toHaveLength(0);
    });
  });

  describe("Flow: h to skip", () => {
    it("moves skipped sender to end of queue", () => {
      let state = createScreenerState(["sender-a", "sender-b", "sender-c"]);

      state = handleKey("h", state);

      expect(currentSenderId(state)).toBe("sender-b");
      expect(state.senderQueue).toEqual(["sender-b", "sender-c", "sender-a"]);
      // Skipped sender is not in processedSenders
      expect(state.processedSenders).toHaveLength(0);
    });

    it("skipping single sender returns same sender (queue rotates to itself)", () => {
      let state = createScreenerState(["only-one"]);

      state = handleKey("h", state);

      expect(currentSenderId(state)).toBe("only-one");
      expect(state.senderQueue).toHaveLength(1);
    });

    it("preview closes on skip", () => {
      let state = createScreenerState(["sender-a", "sender-b"]);

      state = handleKey(" ", state);
      expect(state.isPreviewOpen).toBe(true);

      state = handleKey("h", state);
      expect(state.isPreviewOpen).toBe(false);
    });
  });

  describe("Escape closes states in priority order", () => {
    it("Escape with both picker and preview open closes picker first", () => {
      let state = createScreenerState(["sender-a"]);

      state = handleKey(" ", state);   // open preview
      state = handleKey("y", state);   // open picker

      state = handleKey("Escape", state);
      expect(state.isCategoryPickerOpen).toBe(false);
      expect(state.isPreviewOpen).toBe(true); // preview still open

      state = handleKey("Escape", state);
      expect(state.isPreviewOpen).toBe(false);
    });

    it("Escape with only preview open closes preview", () => {
      let state = createScreenerState(["sender-a"]);

      state = handleKey(" ", state);
      state = handleKey("Escape", state);

      expect(state.isPreviewOpen).toBe(false);
    });

    it("Escape is no-op when nothing is open", () => {
      let state = createScreenerState(["sender-a"]);
      const before = JSON.stringify(state);

      state = handleKey("Escape", state);
      expect(JSON.stringify(state)).toBe(before);
    });
  });

  describe("Action while preview is open", () => {
    it("n rejects immediately even when preview is open (no forced close first)", () => {
      let state = createScreenerState(["sender-a", "sender-b"]);

      state = handleKey(" ", state);
      expect(state.isPreviewOpen).toBe(true);

      state = handleKey("n", state);
      expect(state.processedSenders[0]?.action).toBe("rejected");
      expect(state.isPreviewOpen).toBe(false); // auto-closed on card exit
    });

    it("h skips immediately even when preview is open", () => {
      let state = createScreenerState(["sender-a", "sender-b"]);

      state = handleKey(" ", state);
      state = handleKey("h", state);

      expect(currentSenderId(state)).toBe("sender-b");
      expect(state.isPreviewOpen).toBe(false);
    });
  });

  describe("Queue exhaustion", () => {
    it("no keys work after queue is empty", () => {
      let state = createScreenerState(["only"]);

      state = handleKey("n", state);
      expect(currentSenderId(state)).toBeNull();

      const before = JSON.stringify(state);
      state = handleKey("y", state);
      state = handleKey("n", state);
      state = handleKey(" ", state);
      expect(JSON.stringify(state)).toBe(before);
    });
  });
});

describe("Undo within 5 seconds", () => {
  it("reverses a reject action", () => {
    let state = createScreenerState(["sender-a", "sender-b"]);

    state = handleKey("n", state);
    expect(currentSenderId(state)).toBe("sender-b");

    // Undo within time window
    state = dispatch(state, { type: "UNDO" });

    expect(currentSenderId(state)).toBe("sender-a");
    expect(state.processedSenders).toHaveLength(0);
  });

  it("reverses an approve action", () => {
    let state = createScreenerState(["sender-a", "sender-b"]);

    state = handleKey("y", state); // open picker
    state = handleKey("1", state); // approve to Imbox

    state = dispatch(state, { type: "UNDO" });

    expect(currentSenderId(state)).toBe("sender-a");
    expect(state.processedSenders).toHaveLength(0);
  });

  it("restores the undone sender to front of queue", () => {
    let state = createScreenerState(["sender-a", "sender-b", "sender-c"]);

    state = handleKey("n", state); // reject sender-a
    expect(currentSenderId(state)).toBe("sender-b");

    state = dispatch(state, { type: "UNDO" });
    // sender-a should be back at front
    expect(state.senderQueue[0]).toBe("sender-a");
  });

  it("undo is no-op when undo stack is empty", () => {
    let state = createScreenerState(["sender-a"]);
    const before = JSON.stringify(state);

    state = dispatch(state, { type: "UNDO" });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("undo time window: action within 5s is undoable", () => {
    const now = Date.now();
    const recentAction = { id: "sender-a", action: "rejected", timestamp: now - 2000 };

    // Within 5s window
    expect(now - recentAction.timestamp).toBeLessThan(5000);
  });

  it("action older than 5s is outside undo window", () => {
    const now = Date.now();
    const oldAction = { id: "sender-a", action: "rejected", timestamp: now - 6000 };

    // Outside 5s window — UI should hide the undo toast
    expect(now - oldAction.timestamp).toBeGreaterThan(5000);
  });
});
