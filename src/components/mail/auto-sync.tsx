"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

interface SyncResultData {
  newMessages: number;
  remaining: number;
  totalOnServer: number;
  totalCached: number;
}

interface SyncResponse {
  success: boolean;
  results: SyncResultData[];
  importing?: boolean;
}

export function AutoSync() {
  const router = useRouter();
  const prevDataRef = useRef<SyncResponse | null>(null);
  const lastGoodResultsRef = useRef<SyncResultData[] | null>(null);
  const [importing, setImporting] = useState(false);

  // Stable ref to router for SSE handler (avoids EventSource reconnect on render)
  const routerRef = useRef(router);
  useLayoutEffect(() => {
    routerRef.current = router;
  });

  // SSE: realtime updates from IDLE
  useEffect(() => {
    const es = new EventSource("/api/mail/events");

    const handleEvent = () => routerRef.current.refresh();
    es.addEventListener("new-messages", handleEvent);
    es.addEventListener("flags-changed", handleEvent);
    es.addEventListener("message-deleted", handleEvent);

    es.onerror = () => console.warn("[sse] reconnecting...");

    return () => es.close();
  }, []);

  // Listen for explicit import trigger from ImportButton
  useEffect(() => {
    const handler = () => setImporting(true);
    window.addEventListener("start-import", handler);
    return () => window.removeEventListener("start-import", handler);
  }, []);

  const { data } = useQuery<SyncResponse>({
    queryKey: ["mail-sync", importing],
    queryFn: async () => {
      const url = importing
        ? "/api/mail/sync?batchSize=200"
        : "/api/mail/sync";
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      return res.json();
    },
    refetchInterval: importing ? 1_000 : 30_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    // Skip router refresh when another sync is already in progress
    if (data.importing) return;

    // Track last good results for progress bar display
    if (data.results && data.results.length > 0) {
      lastGoodResultsRef.current = data.results;
    }

    // Exit import mode when all messages have been imported
    if (importing) {
      const hasRemaining = data.results?.some((r) => r.remaining > 0);
      if (!hasRemaining && data.results && data.results.length > 0) {
        setImporting(false);
        lastGoodResultsRef.current = null;
        router.refresh();
      }
      return;
    }

    // Refresh when new messages arrive during normal sync
    const hasNew = data.results?.some((r) => r.newMessages > 0);
    if (hasNew) {
      router.refresh();
    }
  }, [data, router, importing]);

  // Use last good results for progress bar (avoids 0/0 flicker when lock is held)
  const progressResults = lastGoodResultsRef.current;
  if (!importing || !progressResults) return null;

  const synced = progressResults.reduce((s, r) => s + r.totalCached, 0);
  const total = progressResults.reduce((s, r) => s + r.totalOnServer, 0);
  const percent = total > 0 ? Math.round((synced / total) * 100) : 0;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div className="rounded-lg border bg-card px-4 py-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium">
            Importing: {synced.toLocaleString()} / {total.toLocaleString()}
          </div>
          <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">{percent}%</div>
        </div>
      </div>
    </div>
  );
}
