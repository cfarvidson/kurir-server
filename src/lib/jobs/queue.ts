import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { getConfig } from "@/lib/config";

const REDIS_URL = getConfig().redisUrl;

function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    ...(parsed.password ? { password: parsed.password } : {}),
    maxRetriesPerRequest: null,
  };
}

export const redisConnection = parseRedisUrl(REDIS_URL);

// Queue names
export const SYNC_QUEUE = "sync-connection";
export const MAINTENANCE_QUEUE = "maintenance";

// Shared queue instances (created lazily)
let syncQueue: Queue | null = null;
let maintenanceQueue: Queue | null = null;

export function getSyncQueue(): Queue {
  if (!syncQueue) {
    syncQueue = new Queue(SYNC_QUEUE, { connection: redisConnection });
  }
  return syncQueue;
}

export function getMaintenanceQueue(): Queue {
  if (!maintenanceQueue) {
    maintenanceQueue = new Queue(MAINTENANCE_QUEUE, {
      connection: redisConnection,
    });
  }
  return maintenanceQueue;
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([syncQueue?.close(), maintenanceQueue?.close()]);
  syncQueue = null;
  maintenanceQueue = null;
}

export { Worker };
