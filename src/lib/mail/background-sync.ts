import {
  startSyncWorker,
  scheduleSyncJobs,
  stopSyncWorker,
  refreshSyncPriorities,
} from "@/lib/jobs/sync-worker";
import {
  startMaintenanceWorker,
  scheduleMaintenanceJobs,
  stopMaintenanceWorker,
} from "@/lib/jobs/maintenance-worker";
import { closeQueues } from "@/lib/jobs/queue";
import { connectionManager } from "./connection-manager";
import { db } from "@/lib/db";

// Re-export for backward compatibility (used by sync route)
export { checkExpiredFollowUps } from "@/lib/jobs/maintenance-tasks";

let started = false;

const PRIORITY_REFRESH_MS = 5 * 60_000; // Refresh sync priorities every 5 minutes
let priorityInterval: NodeJS.Timeout | null = null;

/** One connection row for boot-time IDLE enumeration. */
export interface BootConnectionRow {
  id: string;
  lastFullSync: Date | null;
}

/**
 * Order connections for boot-time IDLE start: most-recently-synced first,
 * nulls (never-synced) last, deterministic `id` tiebreak. The boot loop starts
 * them in this order and stops at the 25-connection cap, so the connections
 * most likely to have a tight delivery expectation come up first.
 *
 * Pure (no DB / no IMAP) for unit testing.
 */
export function orderConnectionsForBootStart(
  rows: BootConnectionRow[],
): BootConnectionRow[] {
  return [...rows].sort((a, b) => {
    const at = a.lastFullSync?.getTime() ?? null;
    const bt = b.lastFullSync?.getTime() ?? null;
    if (at !== bt) {
      if (at === null) return 1; // a is null → after b
      if (bt === null) return -1; // b is null → after a
      return bt - at; // most recent first
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // deterministic tiebreak
  });
}

/**
 * Start IDLE connections at boot, ordered most-recently-synced first, under the
 * connection cap with no eviction. Runs sequentially (natural pacing for IMAP
 * servers) and isolates per-connection failures — the existing reconnect
 * backoff handles credential errors, so one bad connection never blocks the
 * rest. Stops once the cap is reached.
 *
 * Deliberately invoked OUTSIDE the Redis-dependent BullMQ startup so a Redis
 * outage cannot prevent IDLE connections (and their boot catch-up) from coming
 * up.
 */
export async function startBootIdleConnections(): Promise<void> {
  let rows: BootConnectionRow[];
  try {
    const found = await db.emailConnection.findMany({
      select: { id: true, syncState: { select: { lastFullSync: true } } },
    });
    rows = found.map((c) => ({
      id: c.id,
      lastFullSync: c.syncState?.lastFullSync ?? null,
    }));
  } catch (err) {
    console.error("[bg-sync] Boot IDLE start: failed to enumerate connections:", err);
    return;
  }

  const ordered = orderConnectionsForBootStart(rows);
  let startedCount = 0;

  for (const row of ordered) {
    if (connectionManager.activeCount >= connectionManager.maxConnections) {
      console.log(
        `[bg-sync] Boot IDLE start: cap (${connectionManager.maxConnections}) reached, ${ordered.length - startedCount} connection(s) deferred to lazy start`,
      );
      break;
    }
    try {
      await connectionManager.startConnection(row.id, { evictOnCap: false });
      startedCount++;
    } catch (err) {
      // Isolated failure — existing backoff retries credential errors; continue.
      console.error(
        `[bg-sync] Boot IDLE start failed for connection ${row.id}:`,
        err,
      );
    }
  }

  console.log(
    `[bg-sync] Boot IDLE start: attempted ${startedCount} connection(s)`,
  );
}

export async function startBackgroundSync() {
  if (started) return;
  started = true;

  console.log("[bg-sync] Starting BullMQ-based background sync");

  // Delay startup to let the server fully initialize
  setTimeout(async () => {
    // Start IDLE connections FIRST and OUTSIDE the Redis-dependent block: a
    // Redis outage must not prevent IDLE start (and its boot catch-up), so
    // mail that arrived during downtime is ingested within seconds of boot.
    await startBootIdleConnections().catch((err) =>
      console.error("[bg-sync] Boot IDLE start error:", err),
    );

    try {
      // Start workers
      await startSyncWorker();
      await startMaintenanceWorker();

      // Schedule repeatable jobs
      await scheduleSyncJobs();
      await scheduleMaintenanceJobs();

      // Periodically refresh sync priorities based on SSE activity
      priorityInterval = setInterval(async () => {
        try {
          await refreshSyncPriorities();
        } catch (err) {
          console.error("[bg-sync] Priority refresh error:", err);
        }
      }, PRIORITY_REFRESH_MS);

      // Clear any stale syncError from a previous failed startup
      await db.syncState
        .updateMany({
          where: { syncError: { not: null } },
          data: { syncError: null },
        })
        .catch(() => {});

      console.log("[bg-sync] All workers and jobs started");
    } catch (err) {
      console.error("[bg-sync] Failed to start BullMQ workers:", err);
      console.error("[bg-sync] Sync will not run until Redis is available");
    }
  }, 5_000);
}

export async function stopBackgroundSync() {
  if (priorityInterval) {
    clearInterval(priorityInterval);
    priorityInterval = null;
  }

  await Promise.allSettled([
    stopSyncWorker(),
    stopMaintenanceWorker(),
    closeQueues(),
    connectionManager.stopAll(),
  ]);

  started = false;
  console.log("[bg-sync] All workers stopped");
}
