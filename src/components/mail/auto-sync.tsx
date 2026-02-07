"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function AutoSync() {
  const router = useRouter();
  const hasSynced = useRef(false);

  useEffect(() => {
    if (hasSynced.current) return;
    hasSynced.current = true;

    fetch("/api/mail/sync", { method: "POST" })
      .then((res) => {
        if (res.ok) {
          router.refresh();
        }
      })
      .catch(() => {
        // Ignore sync errors silently
      });
  }, [router]);

  return null;
}
