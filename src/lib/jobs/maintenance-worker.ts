import { Worker, type Job } from "bullmq";
import { db } from "@/lib/db";
import { sendDueScheduledMessages } from "@/lib/mail/scheduled-send";
import {
  redisConnection,
  MAINTENANCE_QUEUE,
  getMaintenanceQueue,
} from "./queue";

// Re-export for use by background-sync
export { checkExpiredFollowUps, wakeExpiredSnoozes } from "./maintenance-tasks";

type MaintenanceJobType =
  | "scheduled-send"
  | "wake-snoozes"
  | "check-follow-ups"
  | "expire-attachments"
  | "cleanup-orphan-uploads";

interface MaintenanceJobData {
  task: MaintenanceJobType;
}

async function processMaintenanceJob(
  job: Job<MaintenanceJobData>,
): Promise<void> {
  const { task } = job.data;

  switch (task) {
    case "scheduled-send":
      await sendDueScheduledMessages();
      break;

    case "wake-snoozes":
      await processAllUsersSnoozes();
      break;

    case "check-follow-ups":
      await processAllUsersFollowUps();
      break;

    case "expire-attachments":
      await expireOldAttachments();
      break;

    case "cleanup-orphan-uploads":
      await cleanupOrphanUploads();
      break;
  }
}

async function processAllUsersSnoozes(): Promise<void> {
  const { wakeExpiredSnoozes } = await import("./maintenance-tasks");

  const users = await db.user.findMany({ select: { id: true } });
  for (const user of users) {
    try {
      await wakeExpiredSnoozes(user.id);
    } catch (err) {
      console.error(`[maintenance] snooze error for ${user.id}:`, err);
    }
  }
}

async function processAllUsersFollowUps(): Promise<void> {
  const { checkExpiredFollowUps } = await import("./maintenance-tasks");

  const users = await db.user.findMany({ select: { id: true } });
  for (const user of users) {
    try {
      await checkExpiredFollowUps(user.id);
    } catch (err) {
      console.error(`[maintenance] follow-up error for ${user.id}:`, err);
    }
  }
}

async function expireOldAttachments(): Promise<void> {
  const result: { count: number }[] = await db.$queryRawUnsafe(`
    UPDATE "Attachment"
    SET content = NULL
    WHERE content IS NOT NULL
      AND "contentId" IS NULL
      AND id IN (
        SELECT a.id FROM "Attachment" a
        JOIN "Message" m ON a."messageId" = m.id
        WHERE m."receivedAt" < NOW() - INTERVAL '30 days'
      )
  `);

  const count = result.length > 0 && "count" in result[0] ? result[0].count : 0;
  if (count > 0) {
    console.log(`[maintenance] Expired ${count} attachment contents`);
  }
}

/**
 * Delete uploaded attachments that are:
 * - Not linked to any message (messageId IS NULL)
 * - Uploaded by a user (userId IS NOT NULL)
 * - Older than 24 hours
 * - Not referenced by any scheduled message
 */
async function cleanupOrphanUploads(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Get all attachment IDs referenced by pending scheduled messages
  const scheduled = await db.scheduledMessage.findMany({
    where: { status: "PENDING", attachmentIds: { isEmpty: false } },
    select: { attachmentIds: true },
  });
  const referencedIds = scheduled.flatMap((s) => s.attachmentIds);

  const result = await db.attachment.deleteMany({
    where: {
      messageId: null,
      userId: { not: null },
      createdAt: { lt: cutoff },
      ...(referencedIds.length > 0 && { id: { notIn: referencedIds } }),
    },
  });

  if (result.count > 0) {
    console.log(`[maintenance] Cleaned up ${result.count} orphaned upload(s)`);
  }
}

let maintenanceWorker: Worker | null = null;

export async function startMaintenanceWorker(): Promise<void> {
  if (maintenanceWorker) return;

  maintenanceWorker = new Worker<MaintenanceJobData>(
    MAINTENANCE_QUEUE,
    processMaintenanceJob,
    {
      connection: redisConnection,
      concurrency: 1,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
    },
  );

  maintenanceWorker.on("failed", (job, err) => {
    console.error(`[maintenance] Job ${job?.data.task} failed:`, err.message);
  });

  console.log("[maintenance] Worker started");
}

export async function scheduleMaintenanceJobs(): Promise<void> {
  const queue = getMaintenanceQueue();

  // Scheduled send: every 30 seconds
  await queue.add(
    "scheduled-send",
    { task: "scheduled-send" as const },
    {
      jobId: "scheduled-send",
      repeat: { every: 30_000 },
    },
  );

  // Wake snoozes: every 60 seconds
  await queue.add(
    "wake-snoozes",
    { task: "wake-snoozes" as const },
    {
      jobId: "wake-snoozes",
      repeat: { every: 60_000 },
    },
  );

  // Check follow-ups: every 60 seconds
  await queue.add(
    "check-follow-ups",
    { task: "check-follow-ups" as const },
    {
      jobId: "check-follow-ups",
      repeat: { every: 60_000 },
    },
  );

  // Expire attachments: every 24 hours
  await queue.add(
    "expire-attachments",
    { task: "expire-attachments" as const },
    {
      jobId: "expire-attachments",
      repeat: { every: 24 * 60 * 60_000 },
    },
  );

  // Cleanup orphaned uploads: every 6 hours
  await queue.add(
    "cleanup-orphan-uploads",
    { task: "cleanup-orphan-uploads" as const },
    {
      jobId: "cleanup-orphan-uploads",
      repeat: { every: 6 * 60 * 60_000 },
    },
  );

  console.log("[maintenance] Scheduled all maintenance jobs");
}

export async function stopMaintenanceWorker(): Promise<void> {
  if (maintenanceWorker) {
    await maintenanceWorker.close();
    maintenanceWorker = null;
    console.log("[maintenance] Worker stopped");
  }
}
