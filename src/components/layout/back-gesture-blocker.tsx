"use client";

import { useEffect } from "react";

/**
 * Manages history-stack behavior in standalone PWA mode.
 *
 * Without this component, an iOS edge swipe-back fires `popstate` and exits
 * (or unexpectedly navigates within) the PWA. We push a guard entry on mount
 * and react to pops with two policies:
 *
 * 1. **Intentional back** — set by `intentionalBack()` in `@/lib/navigation`.
 *    The pop is allowed through unchanged.
 * 2. **User-initiated back with a registered fallback** — `setBackFallback()`
 *    has stored a path (e.g. a thread detail view registered its list path).
 *    Navigate to that fallback so the gesture feels natural.
 * 3. **User-initiated back with no fallback** — top-level page; re-push the
 *    guard to block the accidental exit. This preserves the original intent
 *    of the component.
 */
export function BackGestureBlocker() {
  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator && (navigator as never)["standalone"]);
    if (!isStandalone) return;

    window.history.pushState({ __guard: true }, "");

    function onPopState() {
      // 1. Intentional programmatic back — let it through and refresh the guard
      //    for the next pop.
      if (window.__intentionalBack) {
        window.__intentionalBack = false;
        window.setTimeout(() => {
          window.history.pushState({ __guard: true }, "");
        }, 0);
        return;
      }

      // 2. A detail view (or other opt-in surface) has registered a fallback.
      //    Treat the pop as "user wants to go back" and navigate there.
      const fallback = window.__backFallback;
      if (fallback) {
        delete window.__backFallback;
        window.location.assign(fallback);
        return;
      }

      // 3. Top-level page: re-push the guard to block accidental edge swipes.
      window.history.pushState({ __guard: true }, "");
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return null;
}
