"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

interface SyncResultData {
  newMessages: number;
  remaining: number;
  totalOnServer: number;
  totalCached: number;
}

interface ConnectionResult {
  connectionId: string;
  success: boolean;
  results: SyncResultData[];
  error?: string;
}

interface SyncResponse {
  success: boolean;
  results: ConnectionResult[];
  importing?: boolean;
  wokenSnoozes?: number;
}

export function AutoSync() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState(false);

  // Stable ref to router for SSE handler
  const routerRef = useRef(router);
  useLayoutEffect(() => {
    routerRef.current = router;
  });

  // Immediate sync when tab regains focus
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        queryClient.invalidateQueries({ queryKey: ["mail-sync"] });
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [queryClient]);

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

  // Listen for import trigger from ImportButton
  useEffect(() => {
    const handler = () => setImporting(true);
    window.addEventListener("start-import", handler);
    return () => window.removeEventListener("start-import", handler);
  }, []);

  const { data } = useQuery<SyncResponse>({
    queryKey: ["mail-sync"],
    queryFn: async () => {
      const url = importing
        ? "/api/mail/sync?batchSize=200"
        : "/api/mail/sync";
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      return res.json();
    },
    refetchInterval: importing ? 2_000 : 30_000,
    refetchIntervalInBackground: false,
  });

  // Flatten results
  const flat: SyncResultData[] =
    data?.results?.flatMap((cr) => cr.results ?? []) ?? [];

  // Handle side effects
  const prevRef = useRef<SyncResponse | null>(null);
  useEffect(() => {
    if (!data || data === prevRef.current) return;
    prevRef.current = data;

    if (importing && flat.length > 0) {
      const hasRemaining = flat.some((r) => r.remaining > 0);
      if (!hasRemaining) {
        setImporting(false);
        router.refresh();
        return;
      }
      // Refresh on each batch to show new messages
      router.refresh();
      return;
    }

    // Normal sync: refresh when new messages arrive
    const hasNew = flat.some((r) => r.newMessages > 0);
    const hasWoken = (data.wokenSnoozes ?? 0) > 0;
    if (hasNew || hasWoken) {
      router.refresh();
    }
  }, [data, router, importing, flat]);

  // Progress bar
  if (!importing) return null;

  const synced = flat.reduce((s, r) => s + r.totalCached, 0);
  const total = flat.reduce((s, r) => s + r.totalOnServer, 0);
  const remaining = flat.reduce((s, r) => s + r.remaining, 0);

  if (total === 0) {
    return (
      <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
        <div className="rounded-lg border bg-card px-4 py-3 shadow-lg">
          <div className="text-sm font-medium">Starting import...</div>
        </div>
      </div>
    );
  }

  const percent = Math.round((synced / total) * 100);

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div className="rounded-lg border bg-card px-4 py-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium">
            {remaining > 0
              ? `Importing: ${synced.toLocaleString()} / ${total.toLocaleString()}`
              : "Import complete!"}
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
