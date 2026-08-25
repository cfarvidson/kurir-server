"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { adoptTimezone } from "@/actions/user";

/**
 * Mounted by the mail layout only while the account has never chosen a
 * timezone (issue #37: the column sat on a UTC default nothing could
 * change). Adopts the zone this browser reports, once; the server ignores
 * the write if a zone appeared in the meantime. Refreshes so the calendar
 * and every timestamp redraw in the adopted zone immediately instead of
 * on the next navigation.
 */
export function TimezoneAdoption() {
  const router = useRouter();

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return;
    let cancelled = false;
    adoptTimezone(zone)
      .then((adopted) => {
        if (adopted && !cancelled) router.refresh();
      })
      .catch(() => {
        // Nothing to tell the user: everything keeps rendering in UTC,
        // exactly as before, and the next visit tries again.
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
