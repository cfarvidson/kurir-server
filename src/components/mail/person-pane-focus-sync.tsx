"use client";

import { useEffect } from "react";
import { useKeyboardNavigationStore } from "@/stores/keyboard-navigation-store";
import { usePersonPaneStore } from "@/stores/person-pane-store";
import { personEmailFor, type PersonPaneRow } from "@/lib/mail/person-pane";

/**
 * Points the person pane at the row under the keyboard focus. Rendered by
 * the list components; renders nothing.
 */
export function PersonPaneFocusSync({ rows }: { rows: PersonPaneRow[] }) {
  const focusedIndex = useKeyboardNavigationStore((s) => s.focusedIndex);
  const ownEmails = usePersonPaneStore((s) => s.ownEmails);
  const setEmail = usePersonPaneStore((s) => s.setEmail);

  useEffect(() => {
    const email = personEmailFor(rows[focusedIndex], ownEmails);
    if (email) setEmail(email);
  }, [rows, focusedIndex, ownEmails, setEmail]);

  return null;
}

/** Pins the pane to one address while mounted (thread pages). */
export function PersonPaneTarget({ email }: { email: string | null }) {
  const setEmail = usePersonPaneStore((s) => s.setEmail);
  useEffect(() => {
    if (email) setEmail(email);
  }, [email, setEmail]);
  return null;
}
