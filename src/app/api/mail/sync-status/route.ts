import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSyncQueue } from "@/lib/jobs/queue";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [connections, redisOk] = await Promise.all([
    db.emailConnection.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        email: true,
        syncState: {
          select: {
            isSyncing: true,
            syncError: true,
            lastFullSync: true,
          },
        },
      },
    }),
    Promise.race([
      getSyncQueue()
        .getJobCounts("active")
        .then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), 3000)),
    ]).catch(() => false),
  ]);

  const infraError = redisOk
    ? null
    : "Background sync unavailable — Redis is not reachable";

  return NextResponse.json({
    infraError,
    connections: connections.map((c) => ({
      connectionId: c.id,
      email: c.email,
      isSyncing: c.syncState?.isSyncing ?? false,
      syncError: c.syncState?.syncError ?? null,
      lastFullSync: c.syncState?.lastFullSync?.toISOString() ?? null,
    })),
  });
}
