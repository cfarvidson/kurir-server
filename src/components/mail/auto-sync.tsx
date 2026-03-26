"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { refreshSidebarCounts } from "@/actions/sidebar";

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
  locked?: boolean;
}

interface SyncResponse {
  success: boolean;
  results: ConnectionResult[];
  locked?: boolean;
  wokenSnoozes?: number;
}

export function AutoSync() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState(false);
  const [lockHeld, setLockHeld] = useState(false);
  const [progress, setProgress] = useState<{
    synced: number;
    total: number;
    remaining: number;
  } | null>(null);

  // Dismiss timer cleanup
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  // Stable ref to router for SSE handler
  const routerRef = useRef(router);
  useLayoutEffect(() => {
    routerRef.current = router;
  });

  // Refresh UI when tab regains focus (pick up background sync changes)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void (async () => {
          await refreshSidebarCounts();
          routerRef.current.refresh();
        })();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // SSE: realtime updates from IDLE
  useEffect(() => {
    const es = new EventSource("/api/mail/events");
    const handleEvent = async () => {
      await refreshSidebarCounts();
      queryClient.invalidateQueries({ queryKey: ["sync-status"] });
      routerRef.current.refresh();
    };
    es.addEventListener("new-messages", () => void handleEvent());
    es.addEventListener("flags-changed", () => void handleEvent());
    es.addEventListener("message-deleted", () => void handleEvent());

    es.addEventListener("scheduled-sent", () => {
      toast.success("Scheduled message sent");
      void (async () => {
        await refreshSidebarCounts();
        routerRef.current.refresh();
      })();
    });
    es.addEventListener("scheduled-failed", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      toast.error("Scheduled send failed: " + data.error);
      void (async () => {
        await refreshSidebarCounts();
        routerRef.current.refresh();
      })();
    });

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

  // Only poll the sync API during import (not during normal operation)
  const { data } = useQuery<SyncResponse>({
    queryKey: ["mail-sync"],
    queryFn: async () => {
      const url = "/api/mail/sync?batchSize=200";
      const res = await fetch(url, { method: "POST" });
      if (res.status === 429) {
        // Rate limited — back off and retry after the suggested delay
        const retryAfter = parseInt(res.headers.get("Retry-After") || "30", 10);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        return null;
      }
      if (!res.ok) throw new Error("Sync failed");
      return res.json();
    },
    refetchInterval: importing ? 2_000 : false,
    enabled: importing,
  });

  // Handle import progress
  const prevDataRef = useRef<SyncResponse | null>(null);
  useEffect(() => {
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    const flat: SyncResultData[] =
      data.results?.flatMap((cr) => cr.results ?? []) ?? [];

    if (!importing) return;

    // Another sync holds the lock — wait for it to clear
    if (data.locked) {
      setLockHeld(true);
      return;
    }
    setLockHeld(false);

    const total = flat.reduce((s, r) => s + r.totalOnServer, 0);
    if (total > 0) {
      const synced = flat.reduce((s, r) => s + r.totalCached, 0);
      const remaining = flat.reduce((s, r) => s + r.remaining, 0);
      setProgress({ synced, total, remaining });

      if (remaining === 0) {
        router.refresh();
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(() => {
          setImporting(false);
          setProgress(null);
        }, 2_000);
        return;
      }
      router.refresh();
    }
  }, [data, router, importing]);

  // Progress bar (only visible during import)
  if (!importing) return null;

  if (lockHeld) {
    return (
      <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
        <div className="rounded-lg border bg-card px-4 py-3 shadow-lg">
          <div className="text-sm font-medium">
            Sync in progress, waiting...
          </div>
        </div>
      </div>
    );
  }

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
