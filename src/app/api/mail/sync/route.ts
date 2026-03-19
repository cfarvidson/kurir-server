import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncEmailConnection, type SyncResult } from "@/lib/mail/sync-service";
import { pushToUser } from "@/lib/mail/push-sender";

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
      if (r.newMessages > 0 && r.remaining > 0) {
        line += `, ${r.newMessages} fetched, ${r.remaining} remaining`;
      } else if (r.remaining > 0) {
        line += `, ${r.remaining} remaining`;
      }
      if (r.errors.length > 0) {
        line += `, ${r.errors.length} error${r.errors.length !== 1 ? "s" : ""}`;
      }
      return line;
    })
    .join("\n");
}

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const batchSizeParam = searchParams.get("batchSize");
  const batchSize = batchSizeParam
    ? Math.max(1, Math.min(1000, parseInt(batchSizeParam, 10) || 200))
    : 200;
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
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 },
      );
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
    return NextResponse.json(
      { error: "No email connections found" },
      { status: 400 },
    );
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
          {
            error:
              "Sync already in progress. Wait for it to finish, then retry resync.",
          },
          { status: 409 },
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

      const log = buildSyncLog(result.results);
      if (!result.success) {
        await releaseSyncLock(connectionId, result.error, log);
        allResults.push({
          connectionId,
          success: false,
          results: result.results,
          error: result.error,
        });
      } else {
        await releaseSyncLock(connectionId, undefined, log);
        allResults.push({
          connectionId,
          success: true,
          results: result.results,
        });
      }
    } catch (err) {
      await releaseSyncLock(connectionId, String(err));
      allResults.push({
        connectionId,
        success: false,
        results: [],
        error: String(err),
      });
    }
  }

  const wokenSnoozes = await wakeExpiredSnoozes(userId);

  // Send push notifications for new Imbox messages found during this sync
  const totalNew = allResults.reduce((sum, r) => {
    const results = r.results as SyncResult[];
    return (
      sum + (results?.reduce?.((s, sr) => s + (sr.newMessages || 0), 0) ?? 0)
    );
  }, 0);

  if (totalNew > 0) {
    console.log(
      `[push] Sync found ${totalNew} new messages, checking for Imbox messages...`,
    );

    // Find Imbox messages created in the last 2 minutes (this sync window)
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

    console.log(`[push] Found ${recentImbox.length} recent Imbox messages`);

    if (recentImbox.length > 0) {
      // Dedupe by thread
      const byThread = new Map<string, (typeof recentImbox)[0]>();
      for (const m of recentImbox) {
        const key = m.threadId || m.id;
        if (!byThread.has(key)) byThread.set(key, m);
      }

      for (const m of byThread.values()) {
        console.log(
          `[push] Sending notification: "${m.subject}" from ${m.fromName || m.fromAddress}`,
        );
        pushToUser(userId, {
          title: m.fromName || m.fromAddress,
          body: m.subject || "(no subject)",
          url: `/imbox/${m.id}`,
          tag: m.threadId || m.id,
        }).catch((err) => console.error("[push] sync error:", err));
      }
    }
  }

  return NextResponse.json({
    success: true,
    results: allResults,
    locked: allResults.some((r) => r.locked),
    wokenSnoozes,
  });
}
