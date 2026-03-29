import * as os from "os";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { connectionManager } from "@/lib/mail/connection-manager";
import { getSyncQueue, getMaintenanceQueue } from "@/lib/jobs/queue";

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${Math.round(mb)}MB`;
}

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const mem = process.memoryUsage();
  const uptime = Math.round(process.uptime());

  // --- Postgres ---
  let postgres: {
    connected: boolean;
    version: string | null;
    size: string | null;
  } = { connected: false, version: null, size: null };

  try {
    const [versionResult, sizeResult] = await Promise.all([
      db.$queryRaw<{ version: string }[]>`SELECT version()`,
      db.$queryRaw<
        { pg_size_pretty: string }[]
      >`SELECT pg_size_pretty(pg_database_size(current_database()))`,
    ]);

    postgres = {
      connected: true,
      version: versionResult[0]?.version?.split(",")[0] ?? null,
      size: sizeResult[0]?.pg_size_pretty ?? null,
    };
  } catch {
    // Postgres unavailable
  }

  // --- Redis (queue stats + memory) ---
  let syncStats = { active: 0, waiting: 0, delayed: 0, failed: 0 };
  let maintenanceStats = { active: 0, waiting: 0, delayed: 0, failed: 0 };
  let redisConnected = false;
  let redisMemoryUsed: string | null = null;

  try {
    const syncQueue = getSyncQueue();
    const maintenanceQueue = getMaintenanceQueue();

    const [syncCounts, maintenanceCounts] = await Promise.all([
      syncQueue.getJobCounts("active", "waiting", "delayed", "failed"),
      maintenanceQueue.getJobCounts("active", "waiting", "delayed", "failed"),
    ]);

    syncStats = syncCounts as typeof syncStats;
    maintenanceStats = maintenanceCounts as typeof maintenanceStats;
    redisConnected = true;

    // Reuse BullMQ's Redis connection for memory info
    const client = await syncQueue.client;
    const info = await client.info("memory");
    const match = info.match(/used_memory_human:(\S+)/);
    if (match) {
      redisMemoryUsed = match[1];
    }
  } catch {
    // Redis unavailable
  }

  return NextResponse.json({
    status: "ok",
    uptime,
    postgres,
    redis: {
      connected: redisConnected,
      memoryUsed: redisMemoryUsed,
    },
    memory: {
      heapUsed: formatBytes(mem.heapUsed),
      heapTotal: formatBytes(mem.heapTotal),
      rss: formatBytes(mem.rss),
    },
    system: {
      freeMemory: formatBytes(os.freemem()),
      totalMemory: formatBytes(os.totalmem()),
    },
    sync: syncStats,
    maintenance: maintenanceStats,
    connections: {
      idle: connectionManager.activeCount,
      cap: connectionManager.maxConnections,
    },
  });
}
