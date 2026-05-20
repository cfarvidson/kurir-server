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
    return () => setBackFallback("");
  }, [path]);

  return null;
}
