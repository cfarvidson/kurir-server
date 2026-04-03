"use client";

import { useEffect } from "react";

/**
 * Blocks iOS back-swipe navigation in standalone PWA mode.
 *
 * Pushes a guard entry onto the history stack. If a back navigation
 * occurs (e.g. iOS edge gesture leaking through touch prevention),
 * the popstate handler re-pushes the guard to stay on the current page.
 *
 * Programmatic back navigation must use `intentionalBack()` from
 * `@/lib/navigation` so the guard lets it through.
 */
export function BackGestureBlocker() {
  useEffect(() => {
    // Only needed in standalone PWA mode
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator && (navigator as never)["standalone"]);
    if (!isStandalone) return;

    // Push a guard entry
    window.history.pushState({ __guard: true }, "");

    function onPopState() {
      // Re-push guard to block the back navigation
      window.history.pushState({ __guard: true }, "");
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return null;
}
