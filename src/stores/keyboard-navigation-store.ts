import { create } from "zustand";

interface KeyboardNavigationState {
  /** Index of the focused row in the current list (-1 = none) */
  focusedIndex: number;
  /** Ordered thread IDs from the current list (for j/k in thread view) */
  threadIds: string[];
  /** Base path of the current list (e.g. "/imbox") */
  basePath: string;

  setFocusedIndex: (index: number) => void;
  moveFocus: (delta: number, listLength: number) => void;
  registerList: (threadIds: string[], basePath: string) => void;
  reset: () => void;
}

export const useKeyboardNavigationStore = create<KeyboardNavigationState>(
  (set) => ({
    focusedIndex: -1,
    threadIds: [],
    basePath: "",

    setFocusedIndex: (index) => set({ focusedIndex: index }),

    moveFocus: (delta, listLength) =>
      set((state) => {
        if (listLength === 0) return state;
        const current = state.focusedIndex;
        let next: number;
        if (current === -1) {
          // First navigation: go to first (j) or last (k)
          next = delta > 0 ? 0 : listLength - 1;
        } else {
          next = current + delta;
          // Clamp to bounds (no wrap)
          if (next < 0) next = 0;
          if (next >= listLength) next = listLength - 1;
        }
        return { focusedIndex: next };
      }),

    registerList: (threadIds, basePath) =>
      set({ threadIds, basePath, focusedIndex: -1 }),

    reset: () => set({ focusedIndex: -1, threadIds: [], basePath: "" }),
  }),
);
