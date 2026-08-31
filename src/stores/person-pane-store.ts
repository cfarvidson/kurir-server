import { create } from "zustand";
import { PERSON_PANE_COLLAPSED_KEY } from "@/lib/mail/person-pane";

interface PersonPaneState {
  /** Address the pane is showing (null = nothing focused yet). */
  email: string | null;
  /** Own addresses, so sent mail resolves to the recipient. */
  ownEmails: string[];
  /**
   * Starts false on both server and client so the first client render
   * matches the SSR markup; `hydrateCollapsed` reads localStorage after
   * mount (same pattern as push-notification-banner).
   */
  collapsed: boolean;

  setEmail: (email: string | null) => void;
  setOwnEmails: (emails: string[]) => void;
  setCollapsed: (collapsed: boolean) => void;
  hydrateCollapsed: () => void;
}

export const usePersonPaneStore = create<PersonPaneState>((set) => ({
  email: null,
  ownEmails: [],
  collapsed: false,

  setEmail: (email) =>
    set((state) => {
      const next = email ? email.trim().toLowerCase() : null;
      return next === state.email ? state : { email: next };
    }),
  setOwnEmails: (ownEmails) => set({ ownEmails }),
  setCollapsed: (collapsed) => {
    try {
      window.localStorage.setItem(
        PERSON_PANE_COLLAPSED_KEY,
        collapsed ? "1" : "0",
      );
    } catch {
      // Private mode / blocked storage: the toggle still works for the tab.
    }
    set({ collapsed });
  },
  hydrateCollapsed: () => {
    try {
      if (window.localStorage.getItem(PERSON_PANE_COLLAPSED_KEY) === "1") {
        set({ collapsed: true });
      }
    } catch {
      // Storage unavailable: stay expanded.
    }
  },
}));
