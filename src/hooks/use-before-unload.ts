"use client";

import { useEffect } from "react";

export function useBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [active]);
}
