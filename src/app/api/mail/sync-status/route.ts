import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getBackgroundSyncHealth } from "@/lib/mail/background-sync";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connections = await db.emailConnection.findMany({
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
  });

  const { healthy, error: infraError } = getBackgroundSyncHealth();

  return NextResponse.json({
    infraError: healthy ? null : infraError,
    connections: connections.map((c) => ({
      connectionId: c.id,
      email: c.email,
      isSyncing: c.syncState?.isSyncing ?? false,
      syncError: c.syncState?.syncError ?? null,
      lastFullSync: c.syncState?.lastFullSync?.toISOString() ?? null,
    })),
  });
}
