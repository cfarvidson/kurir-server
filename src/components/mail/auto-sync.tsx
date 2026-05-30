"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { refreshSidebarCounts } from "@/actions/sidebar";
import {
  createRefreshScheduler,
  type RefreshScheduler,
} from "@/lib/mail/refresh-scheduler";

// Trailing debounce window for coalescing refreshes.
const REFRESH_DEBOUNCE_MS = 400;
// Upper bound so sustained activity can't starve refreshes (R8).
const REFRESH_MAX_WAIT_MS = 2_000;
// Grace period before closing the SSE connection on background, so transient
// iOS visibility flips (app-switcher peek, notification shade) don't churn it.
const SSE_DISCONNECT_GRACE_MS = 5_000;
// Backoff bounds for reconnecting a permanently-closed SSE stream while the tab
// is foregrounded (the browser does not auto-reconnect a CLOSED EventSource).
const SSE_RECONNECT_BASE_MS = 5_000;
const SSE_RECONNECT_MAX_MS = 60_000;

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

  // Stable ref to router so the once-constructed scheduler always refreshes
  // through the current router instance (never a stale closure).
  const routerRef = useRef(router);
  useLayoutEffect(() => {
    routerRef.current = router;
  });

  // One coalescing scheduler shared by every refresh trigger (SSE, visibility,
  // and the import-progress poll). A burst of triggers collapses into a single
  // full RSC `router.refresh()` instead of one per trigger — the main cause of
  // the mobile PWA freezing. `isVisible`/`onRefresh` run at fire time so the
  // router ref read is always current. Created in a mount effect (before the
  // SSE effect below) so `schedule()` callers find it ready; `schedule()` is
  // only ever invoked from later async events, so the ordering is safe even on
  // the initial connect.
  const schedulerRef = useRef<RefreshScheduler | null>(null);
  useEffect(() => {
    const scheduler = createRefreshScheduler({
      delayMs: REFRESH_DEBOUNCE_MS,
      maxWait: REFRESH_MAX_WAIT_MS,
      isVisible: () => document.visibilityState === "visible",
      onRefresh: () => {
        void (async () => {
          // Sidebar counts are best-effort — a failed server action must not
          // swallow the view refresh below (or surface as an unhandled
          // rejection), so isolate it.
          try {
            await refreshSidebarCounts();
          } catch {
            // ignore — the RSC refresh below will still pick up changes
          }
          queryClient.invalidateQueries({ queryKey: ["sync-status"] });
          queryClient.invalidateQueries({ queryKey: ["messages"] });
          routerRef.current.refresh();
        })();
      },
    });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.cancel();
      schedulerRef.current = null;
    };
  }, [queryClient]);

  // SSE: realtime updates from IMAP IDLE, tied to page visibility.
  // We deliberately do NOT hold the EventSource open while backgrounded: iOS
  // keeps a suspended connection in a half-open state that can hang the page on
  // resume. We close on hide (after a grace period) and reconnect (plus one
  // catch-up refresh) on resume.
  useEffect(() => {
    let es: EventSource | null = null;
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;

    const schedule = () => schedulerRef.current?.schedule();

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (reconnectTimer || es) return;
      const delay = Math.min(
        SSE_RECONNECT_BASE_MS * 2 ** reconnectAttempts,
        SSE_RECONNECT_MAX_MS,
      );
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        // Only reconnect while foregrounded; a hidden tab reconnects on resume.
        if (document.visibilityState === "visible") {
          reconnectAttempts++;
          connect();
        }
      }, delay);
    };

    const connect = () => {
      if (es) return;
      es = new EventSource("/api/mail/events");
      es.addEventListener("new-messages", schedule);
      es.addEventListener("flags-changed", schedule);
      es.addEventListener("message-deleted", schedule);

      es.addEventListener("scheduled-sent", () => {
        toast.success("Scheduled message sent");
        schedule();
      });
      es.addEventListener("scheduled-failed", (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          toast.error("Scheduled send failed: " + data.error);
        } catch {
          toast.error("Scheduled send failed");
        }
        schedule();
      });

      es.onopen = () => {
        // Connected — reset the backoff window.
        reconnectAttempts = 0;
      };

      es.onerror = () => {
        // The browser auto-reconnects an EventSource on transient errors. Only
        // a permanently-closed stream needs manual recovery (e.g. a 401 on
        // session expiry or a server restart) — without this, realtime would
        // silently die until the next background→resume cycle.
        if (es && es.readyState === EventSource.CLOSED) {
          es = null;
          if (document.visibilityState === "visible") scheduleReconnect();
        }
      };
    };

    const disconnect = () => {
      clearReconnectTimer();
      es?.close();
      es = null;
    };

    const clearDisconnectTimer = () => {
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        // A quick hide→show flip cancels the pending disconnect, avoiding churn.
        clearDisconnectTimer();
        reconnectAttempts = 0;
        connect();
        // Pick up anything that changed while we were backgrounded.
        schedule();
      } else if (!disconnectTimer) {
        // Going hidden: cancel any pending reconnect (we'll reconnect on
        // resume) and defer the close so transient visibility flips don't churn
        // the connection (and the per-connection server-side auth() it triggers).
        clearReconnectTimer();
        disconnectTimer = setTimeout(() => {
          disconnectTimer = null;
          disconnect();
        }, SSE_DISCONNECT_GRACE_MS);
      }
    };

    // The PWA usually launches already foregrounded, but guard anyway.
    if (document.visibilityState === "visible") connect();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      clearDisconnectTimer();
      disconnect();
    };
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

      // Route import-progress refreshes through the shared scheduler so they
      // coalesce and respect the hidden-skip guard (R7) — the 2s poll would
      // otherwise be a second uncoalesced full-refresh storm during the
      // highest-activity period.
      schedulerRef.current?.schedule();

      if (remaining === 0) {
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(() => {
          setImporting(false);
          setProgress(null);
        }, 2_000);
      }
    }
  }, [data, importing]);

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
