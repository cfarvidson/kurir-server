"use client";

import { useEffect } from "react";
import { setBackFallback } from "@/lib/navigation";

/**
 * Registers `path` as the fallback target for the next user-initiated back
 * gesture (see `@/lib/navigation` and `BackGestureBlocker`). Cleared on
 * unmount so top-level pages return to the guard-protected behavior.
 */
export function BackFallback({ path }: { path: string }) {
  useEffect(() => {
    setBackFallback(path);
    return () => {
      // In Next.js route transitions the new page's effect can run before the
      // old page's cleanup. Only clear if we are still the registered owner,
      // so a freshly-set value from the new page survives.
      if (typeof window !== "undefined" && window.__backFallback === path) {
        setBackFallback("");
      }
    };
  }, [path]);

  return null;
}
