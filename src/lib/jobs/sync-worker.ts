import { Worker, type Job } from "bullmq";
import { db } from "@/lib/db";
import { syncEmailConnection, type SyncResult } from "@/lib/mail/sync-service";
import { claimSyncLock, releaseSyncLock } from "@/lib/mail/sync-lock";
import { pushToUser } from "@/lib/mail/push-sender";
import { selectImboxPushes } from "@/lib/mail/push-select";
import { connectionManager } from "@/lib/mail/connection-manager";
import { sseSubscribers, emitToUser } from "@/lib/mail/sse-subscribers";
import { getRedisConnection, SYNC_QUEUE, getSyncQueue } from "./queue";

function buildSyncLog(results: SyncResult[]): string {
  return results
    .map((r) => {
      let line = `${r.folderPath}: ${r.totalOnServer} on server, ${r.totalCached} cached, ${r.newMessages} new`;
      if (r.remaining > 0) line += `, ${r.remaining} remaining`;
      if (r.errors.length > 0) line += `, ${r.errors.length} errors`;
      return line;
    })
    .join("\n");
}

interface SyncJobData {
  emailConnectionId: string;
  userId: string;
}

async function processSyncJob(job: Job<SyncJobData>): Promise<void> {
  const { emailConnectionId, userId } = job.data;

  // Start IDLE connection (no-op if already connected)
  connectionManager.startAllForUser(userId).catch(console.error);

  // Claim DB lock (defense-in-depth alongside BullMQ's job uniqueness)
  const locked = await claimSyncLock(emailConnectionId);
  if (!locked) {
    console.log(`[sync-worker] Lock held for ${emailConnectionId}, skipping`);
    return;
  }

  try {
    const result = await syncEmailConnection(emailConnectionId);
    const log = buildSyncLog(result.results);
    await releaseSyncLock(
      emailConnectionId,
      result.success ? undefined : result.error,
      log,
    );

    // Emit SSE for any new messages across all folders
    const totalNewAll = result.results.reduce(
      (sum, r) => sum + r.newMessages,
      0,
    );
    if (totalNewAll > 0) {
      emitToUser(userId, {
        type: "new-messages",
        data: { folderId: emailConnectionId, count: totalNewAll },
      });
    }

    // Send push notifications for the Imbox messages this sync ingested.
    // Pushing from the sync results (not a createdAt window) survives long
    // multi-folder jobs that finish well after the messages were saved.
    for (const m of selectImboxPushes(result.results)) {
      pushToUser(userId, {
        title: m.fromName || m.fromAddress,
        body: m.subject || "(no subject)",
        url: `/imbox/${m.id}`,
        tag: m.threadId || m.id,
      }).catch((err) => console.error("[sync-worker] push error:", err));
    }
  } catch (err) {
    await releaseSyncLock(emailConnectionId, String(err));
    throw err; // Let BullMQ handle retry
  }
}

let syncWorker: Worker | null = null;

export async function startSyncWorker(): Promise<void> {
  if (syncWorker) return;

  syncWorker = new Worker<SyncJobData>(SYNC_QUEUE, processSyncJob, {
    connection: getRedisConnection(),
    concurrency: 5,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  });

  syncWorker.on("failed", (job, err) => {
    console.error(`[sync-worker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[sync-worker] Started with concurrency 5");
}

/**
 * Schedule repeatable sync jobs for all email connections.
 * Called once at startup, then periodically to pick up new connections.
 */
export async function scheduleSyncJobs(): Promise<void> {
  const connections = await db.emailConnection.findMany({
    select: { id: true, userId: true },
  });

  const queue = getSyncQueue();

  for (const conn of connections) {
    // Determine priority: active SSE subscribers get higher priority
    const isActive = sseSubscribers.has(conn.userId);
    const priority = isActive ? 1 : 10;

    await queue.add(
      "sync",
      { emailConnectionId: conn.id, userId: conn.userId },
      {
        jobId: `sync-${conn.id}`,
        repeat: { every: 60_000 },
        priority,
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
      },
    );
  }

  console.log(
    `[sync-worker] Scheduled ${connections.length} connection sync jobs`,
  );
}

/**
 * Re-sync priorities based on current SSE subscriber status.
 * Called periodically to promote/demote users.
 */
export async function refreshSyncPriorities(): Promise<void> {
  const connections = await db.emailConnection.findMany({
    select: { id: true, userId: true },
  });

  const queue = getSyncQueue();

  for (const conn of connections) {
    const isActive = sseSubscribers.has(conn.userId);
    const priority = isActive ? 1 : 10;

    // BullMQ repeatable jobs: re-adding with same jobId updates the config
    await queue.add(
      "sync",
      { emailConnectionId: conn.id, userId: conn.userId },
      {
        jobId: `sync-${conn.id}`,
        repeat: { every: 60_000 },
        priority,
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
      },
    );
  }
}

export async function stopSyncWorker(): Promise<void> {
  if (syncWorker) {
    await syncWorker.close();
    syncWorker = null;
    console.log("[sync-worker] Stopped");
  }
}
