import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncUserEmail } from "@/lib/mail/sync-service";

const STALE_LOCK_MS = 5 * 60 * 1000; // 5 minutes

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

  // Try to claim the sync lock
  const locked = await claimSyncLock(userId);
  if (!locked) {
    return NextResponse.json({ success: true, results: [], importing: true });
  }

  try {
    const result = await syncUserEmail(userId, batchSize ? { batchSize } : undefined);

    if (!result.success) {
      await releaseSyncLock(userId, result.error);
      return NextResponse.json(
        { error: result.error, results: result.results },
        { status: 500 }
      );
    }

    // Release lock (import may still have remaining messages — that's fine,
    // next call will re-acquire the lock for the next batch)
    await releaseSyncLock(userId);

    return NextResponse.json({
      success: true,
      results: result.results,
    });
  } catch (err) {
    await releaseSyncLock(userId, String(err));
    return NextResponse.json(
      { error: String(err), results: [] },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  // Allow GET for easy testing
  return POST(request);
}
