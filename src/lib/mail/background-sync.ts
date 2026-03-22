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

export async function startBackgroundSync() {
  if (started) return;
  started = true;

  console.log("[bg-sync] Starting BullMQ-based background sync");

  // Delay startup to let the server fully initialize
  setTimeout(async () => {
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
