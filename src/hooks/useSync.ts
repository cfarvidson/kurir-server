"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export type SyncStatus = "synced" | "syncing" | "error" | "stale";

interface ConnectionSyncState {
  connectionId: string;
  email: string;
  isSyncing: boolean;
  syncError: string | null;
  lastFullSync: string | null;
}

interface SyncStatusResponse {
  infraError: string | null;
  connections: ConnectionSyncState[];
}

interface DerivedState {
  status: SyncStatus;
  errorMessage?: string;
  lastSyncTime: Date | null;
}

const POLL_INTERVAL = 60_000;
const STALE_THRESHOLD = 10 * 60_000;

function deriveStatus(data: SyncStatusResponse): DerivedState {
  // Infrastructure error takes priority — background sync can't run at all
  if (data.infraError) {
    return {
      status: "error",
      errorMessage: data.infraError,
      lastSyncTime: null,
    };
  }

  const connections = data.connections;
  if (connections.length === 0) {
    return { status: "synced", lastSyncTime: null };
  }

  const errored = connections.filter((c) => c.syncError);
  if (errored.length > 0) {
    const messages = errored.map((c) => `${c.email}: ${c.syncError}`);
    return {
      status: "error",
      errorMessage:
        messages.length === 1 ? errored[0].syncError! : messages.join("; "),
      lastSyncTime: null,
    };
  }

  if (connections.some((c) => c.isSyncing)) {
    return { status: "syncing", lastSyncTime: null };
  }

  const now = Date.now();
  const oldestSync = connections.reduce<Date | null>((oldest, c) => {
    if (!c.lastFullSync) return oldest;
    const d = new Date(c.lastFullSync);
    return !oldest || d < oldest ? d : oldest;
  }, null);

  if (connections.some((c) => !c.lastFullSync)) {
    return {
      status: "stale",
      errorMessage: "Initial sync has not completed yet",
      lastSyncTime: oldestSync,
    };
  }

  if (oldestSync && now - oldestSync.getTime() > STALE_THRESHOLD) {
    return {
      status: "stale",
      errorMessage: "Email sync is delayed",
      lastSyncTime: oldestSync,
    };
  }

  return { status: "synced", lastSyncTime: oldestSync };
}

const DEFAULT_RESPONSE: SyncStatusResponse = { infraError: null, connections: [] };

async function fetchSyncStatus(): Promise<SyncStatusResponse> {
  const res = await fetch("/api/mail/sync-status");
  if (!res.ok) return DEFAULT_RESPONSE;
  return res.json();
}

export function useSync() {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);

  const { data = DEFAULT_RESPONSE } = useQuery({
    queryKey: ["sync-status"],
    queryFn: fetchSyncStatus,
    refetchInterval: POLL_INTERVAL,
    staleTime: POLL_INTERVAL,
  });

  const derived = deriveStatus(data);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await fetch("/api/mail/sync", { method: "POST" });
      setTimeout(() => {
        queryClient
          .invalidateQueries({ queryKey: ["sync-status"] })
          .finally(() => setRetrying(false));
      }, 3000);
    } catch {
      setRetrying(false);
    }
  }, [queryClient]);

  return {
    ...derived,
    connections: data.connections,
    retry,
    retrying,
  };
}
