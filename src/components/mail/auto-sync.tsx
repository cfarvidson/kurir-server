"use client";

import { useEffect, useRef, useState } from "react";
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
  const [importing, setImporting] = useState(false);

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
    refetchInterval: importing ? 1_000 : 5_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    // Skip router refresh when another sync is already in progress
    if (data.importing) return;

    // Enter import mode when there are remaining messages
    const hasRemaining = data.results?.some((r) => r.remaining > 0);
    if (hasRemaining && !importing) {
      setImporting(true);
    } else if (!hasRemaining && importing) {
      setImporting(false);
      router.refresh();
    }

    // Refresh when new messages arrive during normal sync
    if (!importing) {
      const hasNew = data.results?.some((r) => r.newMessages > 0);
      if (hasNew) {
        router.refresh();
      }
    }
  }, [data, router, importing]);

  if (!importing || !data?.results) return null;

  const synced = data.results.reduce((s, r) => s + r.totalCached, 0);
  const total = data.results.reduce((s, r) => s + r.totalOnServer, 0);
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
