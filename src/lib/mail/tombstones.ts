import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Delete messages and record tombstones so mobile delta-sync clients can
 * remove already-downloaded rows. Use this instead of db.message.deleteMany
 * for deletions that remove mail a client may have synced (IMAP expunges,
 * UIDVALIDITY resets). Whole-connection/user wipes don't need tombstones —
 * the sync response's connection list handles those.
 *
 * Returns the number of deleted messages.
 */
export async function deleteMessagesWithTombstones(
  where: Prisma.MessageWhereInput,
): Promise<number> {
  const doomed = await db.message.findMany({
    where,
    select: { id: true, userId: true },
  });
  if (doomed.length === 0) return 0;

  await db.$transaction([
    db.messageTombstone.createMany({
      data: doomed.map((m) => ({ messageId: m.id, userId: m.userId })),
      skipDuplicates: true,
    }),
    db.message.deleteMany({ where: { id: { in: doomed.map((m) => m.id) } } }),
  ]);

  return doomed.length;
}

const TOMBSTONE_TTL_DAYS = 30;

/** Prune tombstones older than the TTL. Clients with an older cursor resync. */
export async function pruneMessageTombstones(): Promise<number> {
  const cutoff = new Date(Date.now() - TOMBSTONE_TTL_DAYS * 24 * 60 * 60_000);
  const { count } = await db.messageTombstone.deleteMany({
    where: { deletedAt: { lt: cutoff } },
  });
  return count;
}
