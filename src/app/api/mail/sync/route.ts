import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncUserEmail } from "@/lib/mail/sync-service";

const STALE_LOCK_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Wake snoozed messages whose snoozedUntil has passed.
 * Restores them as unread so they resurface in their category view.
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

async function clearUserMailCache(userId: string) {
  await db.$transaction([
    db.message.deleteMany({ where: { userId } }),
    db.folder.deleteMany({ where: { userId } }),
    db.sender.deleteMany({ where: { userId } }),
    db.syncState.update({
      where: { userId },
      data: { lastFullSync: null, syncError: null },
    }),
  ]);
}

async function claimSyncLock(userId: string): Promise<boolean> {
  // Ensure SyncState exists
  await db.syncState.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });

  // Atomic claim: only succeeds if not currently syncing (or lock is stale)
  const claimed = await db.syncState.updateMany({
    where: {
      userId,
      OR: [
        { isSyncing: false },
        { syncStartedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
      ],
    },
    data: { isSyncing: true, syncStartedAt: new Date(), syncError: null },
  });

  return claimed.count > 0;
}

async function releaseSyncLock(userId: string, error?: string) {
  await db.syncState.updateMany({
    where: { userId },
    data: { isSyncing: false, syncError: error || null },
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Parse optional batchSize from query params
  const { searchParams } = new URL(request.url);
  const batchSizeParam = searchParams.get("batchSize");
  const batchSize = batchSizeParam ? parseInt(batchSizeParam, 10) : undefined;
  const shouldResync =
    searchParams.get("resync") === "1" || searchParams.get("resync") === "true";

  // Try to claim the sync lock
  const locked = await claimSyncLock(userId);
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
    // Still wake expired snoozes even when sync is locked
    const wokenSnoozes = await wakeExpiredSnoozes(userId);
    return NextResponse.json({ success: true, results: [], importing: true, wokenSnoozes });
  }

  try {
    if (shouldResync) {
      await clearUserMailCache(userId);
    }

    const result = await syncUserEmail(
      userId,
      batchSize ? { batchSize } : undefined,
    );

    if (!result.success) {
      await releaseSyncLock(userId, result.error);
      return NextResponse.json(
        { error: result.error, results: result.results },
        { status: 500 },
      );
    }

    // Release lock (import may still have remaining messages — that's fine,
    // next call will re-acquire the lock for the next batch)
    await releaseSyncLock(userId);

    // Wake any snoozed messages whose timer has expired
    const wokenSnoozes = await wakeExpiredSnoozes(userId);

    return NextResponse.json({
      success: true,
      results: result.results,
      wokenSnoozes,
    });
  } catch (err) {
    await releaseSyncLock(userId, String(err));
    return NextResponse.json(
      { error: String(err), results: [] },
      { status: 500 },
    );
  }
}

