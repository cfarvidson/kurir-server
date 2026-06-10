import { db } from "@/lib/db";

/**
 * A sync lock is considered stale (and thus reclaimable / "not held") once its
 * `syncStartedAt` is older than this window — a crashed sync that never released
 * the lock must not starve consumers for longer than this.
 */
export const STALE_LOCK_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Atomically claim the sync lock for a connection.
 *
 * Ensures a `SyncState` row exists, then performs a single `updateMany` that
 * only flips `isSyncing` to true when the lock is currently free or stale. The
 * atomic update is the claim — there is no check-then-set race. Returns true
 * only for the caller that won the claim.
 */
export async function claimSyncLock(
  emailConnectionId: string,
): Promise<boolean> {
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

/**
 * Release the sync lock for a connection.
 *
 * `lastFullSync` is advanced only on success (no `error`), preserving the prior
 * semantics. Also logs the lock-hold duration (computed from `syncStartedAt`
 * read just before release) as a single line — the baseline for tuning the
 * IDLE retry budget vs. the deferred sync-cost work.
 */
export async function releaseSyncLock(
  emailConnectionId: string,
  error?: string,
  log?: string,
): Promise<void> {
  // Informational read only — the release below must run unconditionally, so a
  // transient DB error here must not leave the lock stuck until the stale window.
  let state: { syncStartedAt: Date | null } | null = null;
  try {
    state = await db.syncState.findUnique({
      where: { emailConnectionId },
      select: { syncStartedAt: true },
    });
  } catch {
    // Skip the hold-duration log; the release still proceeds.
  }

  await db.syncState.updateMany({
    where: { emailConnectionId },
    data: {
      isSyncing: false,
      syncError: error || null,
      lastSyncLog: log || null,
      ...(!error ? { lastFullSync: new Date() } : {}),
    },
  });

  if (state?.syncStartedAt) {
    const heldMs = Date.now() - state.syncStartedAt.getTime();
    console.log(
      `[sync-lock] Released ${emailConnectionId} after ${heldMs}ms${
        error ? " (error)" : ""
      }`,
    );
  }
}

/**
 * Read-only predicate: is the sync lock currently held?
 *
 * Applies the same staleness window as the claim — a lock whose `syncStartedAt`
 * is older than `STALE_LOCK_MS` (a crashed sync that never released) reads as
 * NOT held, so it cannot starve consumers that gate on this.
 */
export async function isSyncLockHeld(
  emailConnectionId: string,
): Promise<boolean> {
  const state = await db.syncState.findUnique({
    where: { emailConnectionId },
    select: { isSyncing: true, syncStartedAt: true },
  });

  if (!state?.isSyncing) return false;
  if (!state.syncStartedAt) return false;

  return state.syncStartedAt.getTime() >= Date.now() - STALE_LOCK_MS;
}
