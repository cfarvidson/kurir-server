"use client";

import { useEffect, useState } from "react";
import type { CalendarInstanceDTO } from "@/components/calendar/types";
import {
  addDays,
  civilFromZoned,
  formatDateParam,
} from "@/lib/calendar/view-time";

const REFETCH_MS = 5 * 60_000;
const TICK_MS = 30_000;

/**
 * Today's calendar events for the sidebar (Next up card, Calendar panel),
 * plus a clock that ticks every 30 s so "in 20 min" stays true. Refetches
 * every five minutes and when the window regains focus.
 */
export function useTodayEvents(timeZone: string): {
  instances: CalendarInstanceDTO[];
  now: Date;
} {
  const [instances, setInstances] = useState<CalendarInstanceDTO[]>([]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const today = civilFromZoned(new Date(), timeZone);
      const params = new URLSearchParams({
        start: formatDateParam(today),
        end: formatDateParam(addDays(today, 1)),
      });
      try {
        const res = await fetch(`/api/calendar/instances?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as { instances: CalendarInstanceDTO[] };
        if (!cancelled) setInstances(data.instances);
      } catch {
        // Offline: keep what we had.
      }
    }
    load();
    const refetch = setInterval(load, REFETCH_MS);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      clearInterval(refetch);
      window.removeEventListener("focus", load);
    };
  }, [timeZone]);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(tick);
  }, []);

  return { instances, now };
}
