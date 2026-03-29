import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { getConfig } from "@/lib/config";

function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    ...(parsed.password ? { password: parsed.password } : {}),
    maxRetriesPerRequest: null,
  };
}

let _redisConnection: ConnectionOptions | null = null;
export function getRedisConnection(): ConnectionOptions {
  if (!_redisConnection) {
    _redisConnection = parseRedisUrl(getConfig().redisUrl);
  }
  return _redisConnection;
}

// Queue names
export const SYNC_QUEUE = "sync-connection";
export const MAINTENANCE_QUEUE = "maintenance";

// Shared queue instances (created lazily)
let syncQueue: Queue | null = null;
let maintenanceQueue: Queue | null = null;

export function getSyncQueue(): Queue {
  if (!syncQueue) {
    syncQueue = new Queue(SYNC_QUEUE, { connection: getRedisConnection() });
  }
  return syncQueue;
}

export function getMaintenanceQueue(): Queue {
  if (!maintenanceQueue) {
    maintenanceQueue = new Queue(MAINTENANCE_QUEUE, {
      connection: getRedisConnection(),
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
