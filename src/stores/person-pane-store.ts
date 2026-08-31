import { create } from "zustand";
import { PERSON_PANE_COLLAPSED_KEY } from "@/lib/mail/person-pane";

interface PersonPaneState {
  /** Address the pane is showing (null = nothing focused yet). */
  email: string | null;
  /** Own addresses, so sent mail resolves to the recipient. */
  ownEmails: string[];
  collapsed: boolean;

  setEmail: (email: string | null) => void;
  setOwnEmails: (emails: string[]) => void;
  setCollapsed: (collapsed: boolean) => void;
}

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PERSON_PANE_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export const usePersonPaneStore = create<PersonPaneState>((set) => ({
  email: null,
  ownEmails: [],
  collapsed: readCollapsed(),

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
}));
