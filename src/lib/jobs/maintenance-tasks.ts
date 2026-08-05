import { db } from "@/lib/db";
import { getOwnAddresses } from "@/lib/mail/user-emails";
import { ownSenderEmailWhere } from "@/lib/mail/pending-senders";

export async function checkExpiredFollowUps(userId: string): Promise<number> {
  const own = await getOwnAddresses(userId);

  const count = await db.$executeRawUnsafe(
    `
    WITH expired AS (
      SELECT DISTINCT "threadId", "followUpSetAt"
      FROM "Message"
      WHERE "userId" = $1
        AND "followUpAt" <= NOW()
        AND "isFollowUp" = false
        AND "followUpAt" IS NOT NULL
        AND "threadId" IS NOT NULL
        AND "isArchived" = false
    ),
    no_reply AS (
      SELECT e."threadId"
      FROM expired e
      WHERE NOT EXISTS (
        SELECT 1 FROM "Message" m2
        WHERE m2."threadId" = e."threadId"
          AND m2."userId" = $1
          AND m2."receivedAt" > e."followUpSetAt"
          AND LOWER(m2."fromAddress") != ALL($2::text[])
          AND split_part(LOWER(m2."fromAddress"), '@', 2) != ALL($3::text[])
      )
    )
    UPDATE "Message" SET "isFollowUp" = true
    WHERE "userId" = $1
      AND "threadId" IN (SELECT "threadId" FROM no_reply)
      AND "followUpAt" IS NOT NULL
      AND "isArchived" = false
    `,
    userId,
    own.emails,
    own.domains,
  );

  return count;
}

export async function wakeExpiredSnoozes(userId: string): Promise<number> {
  const result = await db.message.updateMany({
    where: {
      userId,
      isSnoozed: true,
      snoozedUntil: { lte: new Date() },
    },
    // Clear snooze state only. Read state is preserved so a message the user
    // already read does not reappear as unread ("new") when its snooze expires.
    data: {
      isSnoozed: false,
      snoozedUntil: null,
    },
  });
  return result.count;
}

/**
 * Ghost sweep: PENDING senders that are actually the user's own addresses
 * (added as alias later, or covered by treatDomainAsOwn) are approved into
 * Imbox, mirroring approveSenderForUser's reclassification.
 */
export async function approveOwnPendingSenders(
  userId: string,
): Promise<number> {
  const own = await getOwnAddresses(userId);
  const ownWhere = ownSenderEmailWhere(own);
  if (!ownWhere) return 0;

  const ghosts = await db.sender.findMany({
    where: { userId, status: "PENDING", ...ownWhere },
    select: { id: true },
  });
  if (ghosts.length === 0) return 0;
  const ids = ghosts.map((g) => g.id);

  await db.$transaction([
    db.sender.updateMany({
      where: { id: { in: ids } },
      data: { status: "APPROVED", category: "IMBOX", decidedAt: new Date() },
    }),
    db.message.updateMany({
      where: { senderId: { in: ids }, isArchived: false },
      data: {
        isInScreener: false,
        isInImbox: true,
        isInFeed: false,
        isInPaperTrail: false,
      },
    }),
  ]);
  console.log(
    `[maintenance] Approved ${ids.length} own-address pending sender(s)`,
  );
  return ids.length;
}
