"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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

  // Coalesce refreshes. A burst of IDLE events (or an SSE reconnect that
  // replays buffered events on resume) would otherwise fire one full RSC
  // `router.refresh()` per event — the main cause of the mobile PWA freezing.
  // Debounce so a burst collapses into a single refresh, and never churn while
  // the tab is hidden (we refresh once on resume instead).
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      if (document.visibilityState !== "visible") return;
      void (async () => {
        await refreshSidebarCounts();
        queryClient.invalidateQueries({ queryKey: ["sync-status"] });
        queryClient.invalidateQueries({ queryKey: ["messages"] });
        routerRef.current.refresh();
      })();
    }, 400);
  }, [queryClient]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  // SSE: realtime updates from IMAP IDLE, tied to page visibility.
  // We deliberately do NOT hold the EventSource open while backgrounded: iOS
  // keeps a suspended connection in a half-open state that can hang the page on
  // resume. Instead we close on hide and reconnect (plus one refresh) on resume.
  useEffect(() => {
    let es: EventSource | null = null;

    const connect = () => {
      if (es) return;
      es = new EventSource("/api/mail/events");
      es.addEventListener("new-messages", scheduleRefresh);
      es.addEventListener("flags-changed", scheduleRefresh);
      es.addEventListener("message-deleted", scheduleRefresh);

      es.addEventListener("scheduled-sent", () => {
        toast.success("Scheduled message sent");
        scheduleRefresh();
      });
      es.addEventListener("scheduled-failed", (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          toast.error("Scheduled send failed: " + data.error);
        } catch {
          toast.error("Scheduled send failed");
        }
        scheduleRefresh();
      });

      es.onerror = () => {
        // The browser auto-reconnects an EventSource unless it's permanently
        // closed. If it is, drop our handle so we reconnect on the next resume.
        if (es && es.readyState === EventSource.CLOSED) es = null;
      };
    };

    const disconnect = () => {
      es?.close();
      es = null;
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        connect();
        // Pick up anything that changed while we were backgrounded.
        scheduleRefresh();
      } else {
        disconnect();
      }
    };

    // The PWA usually launches already foregrounded, but guard anyway.
    if (document.visibilityState === "visible") connect();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      disconnect();
    };
  }, [scheduleRefresh]);

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
        queryClient.invalidateQueries({ queryKey: ["messages"] });
        router.refresh();
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(() => {
          setImporting(false);
          setProgress(null);
        }, 2_000);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      router.refresh();
    }
  }, [data, router, importing, queryClient]);

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
