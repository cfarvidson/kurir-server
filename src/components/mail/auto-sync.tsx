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
  const [progress, setProgress] = useState<{
    synced: number;
    total: number;
    remaining: number;
  } | null>(null);

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

  // When importing starts, trigger an immediate refetch with batchSize
  useEffect(() => {
    if (importing) {
      queryClient.invalidateQueries({ queryKey: ["mail-sync"] });
    }
  }, [importing, queryClient]);

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

  // Handle sync results — only update progress when we get real data
  const prevDataRef = useRef<SyncResponse | null>(null);
  useEffect(() => {
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    const flat: SyncResultData[] =
      data.results?.flatMap((cr) => cr.results ?? []) ?? [];

    if (importing) {
      const total = flat.reduce((s, r) => s + r.totalOnServer, 0);
      if (total > 0) {
        const synced = flat.reduce((s, r) => s + r.totalCached, 0);
        const remaining = flat.reduce((s, r) => s + r.remaining, 0);
        setProgress({ synced, total, remaining });

        if (remaining === 0) {
          setImporting(false);
          setProgress(null);
        }
        router.refresh();
      }
      // When total === 0 (lock held, empty response), keep current progress
      return;
    }

    // Normal sync: refresh when new messages arrive
    const hasNew = flat.some((r) => r.newMessages > 0);
    const hasWoken = (data.wokenSnoozes ?? 0) > 0;
    if (hasNew || hasWoken) {
      router.refresh();
    }
  }, [data, router, importing]);

  // Progress bar
  if (!importing) return null;

  if (!progress) {
    return (
      <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
        <div className="rounded-lg border bg-card px-4 py-3 shadow-lg">
          <div className="text-sm font-medium">Starting import...</div>
        </div>
      </div>
    );
  }

  const percent = Math.round((progress.synced / progress.total) * 100);

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div className="rounded-lg border bg-card px-4 py-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium">
            {progress.remaining > 0
              ? `Importing: ${progress.synced.toLocaleString()} / ${progress.total.toLocaleString()}`
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
