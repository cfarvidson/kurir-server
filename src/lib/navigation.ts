/**
 * Helpers for cooperating with `BackGestureBlocker`.
 *
 * `BackGestureBlocker` runs in standalone PWA mode and pushes a guard entry
 * onto `history` to absorb accidental iOS edge swipes. These helpers let a
 * subtree opt into "real" back navigation:
 *
 * - `setBackFallback(path)` — register where the next user-initiated `back`
 *   should land if there is nothing further to pop. Cleared with `""`.
 * - `intentionalBack(fallback?)` — programmatic back that the guard lets
 *   through. Falls back to the registered fallback (or `/imbox`) when the
 *   history stack has no app entry to pop to.
 *
 * The guard reads `window.__backFallback` to decide whether a user-initiated
 * pop (e.g. an iOS swipe-back) should navigate to that fallback or be
 * re-blocked. Top-level pages that intentionally want the guard's protection
 * simply never call `setBackFallback`.
 */

declare global {
  interface Window {
    __intentionalBack?: boolean;
    __backFallback?: string;
  }
}

const DEFAULT_FALLBACK = "/imbox";

export function setBackFallback(path: string) {
  if (typeof window === "undefined") return;
  if (path) {
    window.__backFallback = path;
  } else {
    delete window.__backFallback;
  }
}

export function intentionalBack(fallback?: string) {
  if (typeof window === "undefined") return;

  const target = fallback ?? window.__backFallback ?? DEFAULT_FALLBACK;
  const beforeHref = window.location.href;

  window.__intentionalBack = true;
  window.history.back();

  // If nothing actually changes (no app entry on the stack), force a navigation
  // to the fallback so the user is not stranded.
  window.setTimeout(() => {
    if (window.location.href === beforeHref) {
      window.__intentionalBack = false;
      window.location.assign(target);
    }
  }, 80);
}
