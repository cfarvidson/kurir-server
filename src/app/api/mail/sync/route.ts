import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncEmailConnection } from "@/lib/mail/sync-service";

const STALE_LOCK_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Wake snoozed messages whose snoozedUntil has passed.
 * Piggybacks on the existing ~30s AutoSync poll.
 */
async function wakeExpiredSnoozes(userId: string): Promise<number> {
  const result = await db.message.updateMany({
    where: {
      userId,
      isSnoozed: true,
      snoozedUntil: { lte: new Date() },
    },
    data: {
      isSnoozed: false,
      snoozedUntil: null,
      isRead: false,
    },
  });

  if (result.count > 0) {
    revalidateTag("sidebar-counts");
    revalidatePath("/imbox");
    revalidatePath("/feed");
    revalidatePath("/paper-trail");
    revalidatePath("/snoozed");
  }

  return result.count;
}

async function clearConnectionMailCache(emailConnectionId: string) {
  // Delete messages, folders, and senders for this specific connection
  await db.$transaction([
    db.message.deleteMany({ where: { emailConnectionId } }),
    db.folder.deleteMany({ where: { emailConnectionId } }),
    db.sender.deleteMany({ where: { emailConnectionId } }),
    db.syncState.update({
      where: { emailConnectionId },
      data: { lastFullSync: null, syncError: null },
    }),
  ]);
}

async function claimSyncLock(emailConnectionId: string): Promise<boolean> {
  // Ensure SyncState exists for this connection
  await db.syncState.upsert({
    where: { emailConnectionId },
    create: { emailConnectionId },
    update: {},
  });

  // Atomic claim: only succeeds if not currently syncing (or lock is stale)
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

async function releaseSyncLock(emailConnectionId: string, error?: string) {
  await db.syncState.updateMany({
    where: { emailConnectionId },
    data: {
      isSyncing: false,
      syncError: error || null,
      ...(!error ? { lastFullSync: new Date() } : {}),
    },
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const batchSizeParam = searchParams.get("batchSize");
  const batchSize = batchSizeParam ? parseInt(batchSizeParam, 10) : 200;
  const shouldResync =
    searchParams.get("resync") === "1" || searchParams.get("resync") === "true";
  const connectionIdParam = searchParams.get("connectionId");

  // Determine which connections to sync
  let connectionIds: string[];
  if (connectionIdParam) {
    // Verify the connection belongs to this user
    const conn = await db.emailConnection.findFirst({
      where: { id: connectionIdParam, userId },
      select: { id: true },
    });
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    connectionIds = [connectionIdParam];
  } else {
    // Sync all connections for the user
    const conns = await db.emailConnection.findMany({
      where: { userId },
      select: { id: true },
    });
    connectionIds = conns.map((c) => c.id);
  }

  if (connectionIds.length === 0) {
    return NextResponse.json({ error: "No email connections found" }, { status: 400 });
  }

  // Run sync for each connection, collecting results
  const allResults: Array<{
    connectionId: string;
    success: boolean;
    results: unknown[];
    error?: string;
    locked?: boolean;
  }> = [];

  for (const connectionId of connectionIds) {
    const locked = await claimSyncLock(connectionId);
    if (!locked) {
      if (shouldResync) {
        return NextResponse.json(
          { error: "Sync already in progress. Wait for it to finish, then retry resync." },
          { status: 409 }
        );
      }
      allResults.push({
        connectionId,
        success: true,
        results: [],
        locked: true,
      });
      continue;
    }

    try {
      if (shouldResync) {
        await clearConnectionMailCache(connectionId);
      }

      const result = await syncEmailConnection(
        connectionId,
        batchSize ? { batchSize } : undefined,
      );

      if (!result.success) {
        await releaseSyncLock(connectionId, result.error);
        allResults.push({ connectionId, success: false, results: result.results, error: result.error });
      } else {
        await releaseSyncLock(connectionId);
        allResults.push({ connectionId, success: true, results: result.results });
      }
    } catch (err) {
      await releaseSyncLock(connectionId, String(err));
      allResults.push({ connectionId, success: false, results: [], error: String(err) });
    }
  }

  const wokenSnoozes = await wakeExpiredSnoozes(userId);

  return NextResponse.json({
    success: true,
    results: allResults,
    locked: allResults.some((r) => r.locked),
    wokenSnoozes,
  });
}
