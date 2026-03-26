import { Worker, type Job } from "bullmq";
import { db } from "@/lib/db";
import { syncEmailConnection, type SyncResult } from "@/lib/mail/sync-service";
import { pushToUser } from "@/lib/mail/push-sender";
import { connectionManager } from "@/lib/mail/connection-manager";
import { sseSubscribers, emitToUser } from "@/lib/mail/sse-subscribers";
import { redisConnection, SYNC_QUEUE, getSyncQueue } from "./queue";

const STALE_LOCK_MS = 5 * 60 * 1000; // 5 minutes

async function claimSyncLock(emailConnectionId: string): Promise<boolean> {
  await db.syncState.upsert({
    where: { emailConnectionId },
    create: { emailConnectionId },
    update: {},
  });

  const claimed = await db.syncState.updateMany({
    where: {
      emailConnectionId,
      OR: [
        { isSyncing: false },
        { syncStartedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
      ],
    },
    data: { isSyncing: true, syncStartedAt: new Date(), syncError: null },
  });

  return claimed.count > 0;
}

async function releaseSyncLock(
  emailConnectionId: string,
  error?: string,
  log?: string,
) {
  await db.syncState.updateMany({
    where: { emailConnectionId },
    data: {
      isSyncing: false,
      syncError: error || null,
      lastSyncLog: log || null,
      ...(!error ? { lastFullSync: new Date() } : {}),
    },
  });
}

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

    // Send push notifications only for new Imbox messages
    const totalNewInbox = result.results
      .filter((r) => r.folderPath === "INBOX")
      .reduce((sum, r) => sum + r.newMessages, 0);
    if (totalNewInbox > 0) {
      await sendPushForNewMessages(userId);
    }
  } catch (err) {
    await releaseSyncLock(emailConnectionId, String(err));
    throw err; // Let BullMQ handle retry
  }
}

async function sendPushForNewMessages(userId: string): Promise<void> {
  const recentImbox = await db.message.findMany({
    where: {
      userId,
      isInImbox: true,
      createdAt: { gte: new Date(Date.now() - 120_000) },
    },
    select: {
      id: true,
      fromName: true,
      fromAddress: true,
      subject: true,
      threadId: true,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  if (recentImbox.length === 0) return;

  const byThread = new Map<string, (typeof recentImbox)[0]>();
  for (const m of recentImbox) {
    const key = m.threadId || m.id;
    if (!byThread.has(key)) byThread.set(key, m);
  }

  for (const m of byThread.values()) {
    pushToUser(userId, {
      title: m.fromName || m.fromAddress,
      body: m.subject || "(no subject)",
      url: `/imbox/${m.id}`,
      tag: m.threadId || m.id,
    }).catch((err) => console.error("[sync-worker] push error:", err));
  }
}

let syncWorker: Worker | null = null;

export async function startSyncWorker(): Promise<void> {
  if (syncWorker) return;

  syncWorker = new Worker<SyncJobData>(SYNC_QUEUE, processSyncJob, {
    connection: redisConnection,
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
