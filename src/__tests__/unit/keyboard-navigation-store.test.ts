import { describe, it, expect, beforeEach } from "vitest";
import { useKeyboardNavigationStore } from "@/stores/keyboard-navigation-store";

describe("keyboard-navigation-store", () => {
  beforeEach(() => {
    useKeyboardNavigationStore.getState().reset();
  });

  describe("initial state", () => {
    it("starts with focusedIndex -1", () => {
      expect(useKeyboardNavigationStore.getState().focusedIndex).toBe(-1);
    });

    it("starts with empty threadIds", () => {
      expect(useKeyboardNavigationStore.getState().threadIds).toEqual([]);
    });
  });

  describe("registerList", () => {
    it("sets threadIds, basePath, and resets focusedIndex", () => {
      const store = useKeyboardNavigationStore.getState();
      store.setFocusedIndex(5);
      store.registerList(["a", "b", "c"], "/imbox");

      const state = useKeyboardNavigationStore.getState();
      expect(state.threadIds).toEqual(["a", "b", "c"]);
      expect(state.basePath).toBe("/imbox");
      expect(state.focusedIndex).toBe(-1);
    });
  });

  describe("moveFocus", () => {
    it("moves to first item when starting from -1 with delta +1", () => {
      const store = useKeyboardNavigationStore.getState();
      store.moveFocus(1, 5);
      expect(useKeyboardNavigationStore.getState().focusedIndex).toBe(0);
    });

    it("moves to last item when starting from -1 with delta -1", () => {
      const store = useKeyboardNavigationStore.getState();
      store.moveFocus(-1, 5);
      expect(useKeyboardNavigationStore.getState().focusedIndex).toBe(4);
    });

    it("increments by 1", () => {
      const store = useKeyboardNavigationStore.getState();
      store.setFocusedIndex(2);
      store.moveFocus(1, 5);
      expect(useKeyboardNavigationStore.getState().focusedIndex).toBe(3);
    });

    it("decrements by 1", () => {
      const store = useKeyboardNavigationStore.getState();
      store.setFocusedIndex(2);
      store.moveFocus(-1, 5);
      expect(useKeyboardNavigationStore.getState().focusedIndex).toBe(1);
    });

    it("clamps at end (no wrap)", () => {
      const store = useKeyboardNavigationStore.getState();
      store.setFocusedIndex(4);
      store.moveFocus(1, 5);
      expect(useKeyboardNavigationStore.getState().focusedIndex).toBe(4);
    });

    it("clamps at start (no wrap)", () => {
      const store = useKeyboardNavigationStore.getState();
      store.setFocusedIndex(0);
      store.moveFocus(-1, 5);
      expect(useKeyboardNavigationStore.getState().focusedIndex).toBe(0);
    });

    it("does nothing with empty list", () => {
      const store = useKeyboardNavigationStore.getState();
      store.moveFocus(1, 0);
      expect(useKeyboardNavigationStore.getState().focusedIndex).toBe(-1);
    });
  });

  describe("setFocusedIndex", () => {
    it("sets the focused index directly", () => {
      useKeyboardNavigationStore.getState().setFocusedIndex(3);
      expect(useKeyboardNavigationStore.getState().focusedIndex).toBe(3);
    });
  });

  describe("reset", () => {
    it("resets all state to defaults", () => {
      const store = useKeyboardNavigationStore.getState();
      store.registerList(["a", "b"], "/feed");
      store.setFocusedIndex(1);
      store.reset();

      const state = useKeyboardNavigationStore.getState();
      expect(state.focusedIndex).toBe(-1);
      expect(state.threadIds).toEqual([]);
      expect(state.basePath).toBe("");
    });
  });
});
