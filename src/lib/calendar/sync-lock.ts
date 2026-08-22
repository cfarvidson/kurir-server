import { randomUUID } from "crypto";
import { db } from "@/lib/db";

/**
 * A sync lock is considered stale (and thus reclaimable) once its
 * `syncLockAt` is older than this window - a crashed sync that never released
 * the lock must not starve consumers for longer than this.
 */
export const STALE_LOCK_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Atomically claim the sync lock for a calendar account.
 *
 * Performs a single `updateMany` that only flips `isSyncing` to true when the
 * lock is currently free or stale. The atomic update is the claim - there is
 * no check-then-set race. Returns true only for the caller that won the claim.
 * The CalendarAccount row must already exist.
 */
export async function claimCalendarSyncLock(
  accountId: string,
): Promise<boolean> {
  const claimed = await db.calendarAccount.updateMany({
    where: {
      id: accountId,
      OR: [
        { isSyncing: false },
        { syncLockAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
      ],
    },
    data: {
      isSyncing: true,
      syncLockAt: new Date(),
      lastError: null,
      syncLockToken: randomUUID(),
    },
  });

  return claimed.count > 0;
}

/** Refresh the stale window while a long sync is still running. */
export async function heartbeatCalendarSyncLock(
  accountId: string,
): Promise<void> {
  try {
    await db.calendarAccount.updateMany({
      where: { id: accountId, isSyncing: true },
      data: { syncLockAt: new Date() },
    });
  } catch {
    // Best-effort - a heartbeat failure must not abort an in-flight sync.
  }
}

/**
 * Release the sync lock for a calendar account.
 *
 * `lastSyncedAt` is advanced only on success (no `error`). Failure sets
 * `lastError` and leaves `lastSyncedAt` unchanged.
 */
export async function releaseCalendarSyncLock(
  accountId: string,
  error?: string,
): Promise<void> {
  // Informational read only - the release below must run unconditionally, so a
  // transient DB error here must not leave the lock stuck until the stale window.
  let account: { syncLockAt: Date | null } | null = null;
  try {
    account = await db.calendarAccount.findUnique({
      where: { id: accountId },
      select: { syncLockAt: true },
    });
  } catch {
    // Skip the hold-duration log; the release still proceeds.
  }

  await db.calendarAccount.updateMany({
    where: { id: accountId },
    data: {
      isSyncing: false,
      lastError: error || null,
      ...(!error ? { lastSyncedAt: new Date() } : {}),
    },
  });

  if (account?.syncLockAt) {
    const heldMs = Date.now() - account.syncLockAt.getTime();
    console.log(
      `[calendar-sync-lock] Released ${accountId} after ${heldMs}ms${
        error ? " (error)" : ""
      }`,
    );
  }
}
