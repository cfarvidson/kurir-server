import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
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

  // BullMQ queue stats
  let syncStats = { active: 0, waiting: 0, delayed: 0, failed: 0 };
  let maintenanceStats = { active: 0, waiting: 0, delayed: 0, failed: 0 };
  let redisConnected = false;

  try {
    const syncQueue = getSyncQueue();
    const maintenanceQueue = getMaintenanceQueue();

    const [syncCounts, maintenanceCounts] = await Promise.all([
      syncQueue.getJobCounts("active", "waiting", "delayed", "failed"),
      maintenanceQueue.getJobCounts(
        "active",
        "waiting",
        "delayed",
        "failed",
      ),
    ]);

    syncStats = syncCounts as typeof syncStats;
    maintenanceStats = maintenanceCounts as typeof maintenanceStats;
    redisConnected = true;
  } catch {
    // Redis unavailable
  }

  return NextResponse.json({
    status: "ok",
    uptime,
    sync: syncStats,
    maintenance: maintenanceStats,
    connections: {
      idle: connectionManager.activeCount,
      cap: connectionManager.maxConnections,
    },
    memory: {
      heapUsed: formatBytes(mem.heapUsed),
      heapTotal: formatBytes(mem.heapTotal),
      rss: formatBytes(mem.rss),
    },
    redis: {
      connected: redisConnected,
    },
  });
}
