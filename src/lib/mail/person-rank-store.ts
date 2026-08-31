import { db } from "@/lib/db";
import {
  materialiseRank,
  type PersonRank,
  type PersonRankRow,
} from "@/lib/mail/person-stats";
import { getOwnAddresses } from "@/lib/mail/user-emails";

/**
 * Materialised Rank (kurir-ios#117). The formula lives in person-stats.ts;
 * this module persists its output in `PersonRank`, one row per counterpart,
 * so the pane's Network, ranked people search, compose autosuggest and the
 * profile's position read a table instead of re-ranking the mailbox.
 *
 * - `recomputePersonRank` rewrites the user's rows in one transaction.
 * - `kickRankRecompute` runs it detached after a completed sync: the sync
 *   returns at once, one recompute runs per user at a time, and a kick that
 *   lands mid-run queues exactly one more (never a pile-up).
 * - `readPersonRank` gives score / position / total for one address, or
 *   null when the user has no rows yet (never computed).
 */

export const RANK_SOURCE_COLUMNS = {
  fromAddress: true,
  fromName: true,
  toAddresses: true,
  ccAddresses: true,
  bccAddresses: true,
  receivedAt: true,
  messageId: true,
  inReplyTo: true,
} as const;

/** Recompute and store the ranking for `userId`. Returns rows written. */
export async function recomputePersonRank(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const [own, rows] = await Promise.all([
    getOwnAddresses(userId),
    db.message.findMany({
      where: { userId, isDraft: false },
      select: RANK_SOURCE_COLUMNS,
    }),
  ]);
  const ranked: PersonRankRow[] = materialiseRank(rows, own, now);
  await db.$transaction([
    db.personRank.deleteMany({ where: { userId } }),
    ...(ranked.length > 0
      ? [
          db.personRank.createMany({
            data: ranked.map((r) => ({ userId, ...r, computedAt: now })),
          }),
        ]
      : []),
  ]);
  return ranked.length;
}

const running = new Set<string>();
const queued = new Set<string>();

/** Start a recompute for `userId` without waiting; coalesces repeats. */
export function kickRankRecompute(userId: string): void {
  if (running.has(userId)) {
    queued.add(userId);
    return;
  }
  running.add(userId);
  void (async () => {
    try {
      // A failure does not drop a kick that landed mid-run: that rerun
      // still happens (once), and the next completed sync kicks again.
      do {
        queued.delete(userId);
        try {
          const count = await recomputePersonRank(userId);
          console.log(`[rank] ranked ${count} people for ${userId}`);
        } catch (err) {
          console.error(`[rank] recompute failed for ${userId}`, err);
        }
      } while (queued.has(userId));
    } finally {
      running.delete(userId);
    }
  })();
}

/** Test hook: forget in-flight state. */
export function resetRankKicks(): void {
  running.clear();
  queued.clear();
}

/**
 * Score, 1-based position and total for `email` from the materialised
 * table. The position counts scored rows only ("the people you mail");
 * an address seen but never exchanged with sits at score 0 and has none.
 * Null when the user has no rows at all (the ranking was never computed),
 * so the caller can fall back and kick a recompute.
 */
export async function readPersonRank(
  userId: string,
  rawEmail: string,
): Promise<PersonRank | null> {
  const email = rawEmail.trim().toLowerCase();
  const [row, total, of] = await Promise.all([
    db.personRank.findUnique({
      where: { userId_email: { userId, email } },
      select: { score: true },
    }),
    db.personRank.count({ where: { userId } }),
    db.personRank.count({ where: { userId, score: { gt: 0 } } }),
  ]);
  if (total === 0) return null;
  if (!row || row.score <= 0) return { score: 0, position: null, of };
  const ahead = await db.personRank.count({
    where: {
      userId,
      OR: [{ score: { gt: row.score } }, { score: row.score, email: { lt: email } }],
    },
  });
  return { score: row.score, position: ahead + 1, of };
}
