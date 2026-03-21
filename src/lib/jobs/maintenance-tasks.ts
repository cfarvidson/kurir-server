import { db } from "@/lib/db";

export async function checkExpiredFollowUps(
  userId: string,
): Promise<number> {
  const connections = await db.emailConnection.findMany({
    where: { userId },
    select: { email: true, sendAsEmail: true, aliases: true },
  });
  const userEmails = [
    ...new Set(
      connections
        .flatMap((c) => [c.email, c.sendAsEmail, ...c.aliases])
        .filter(Boolean)
        .map((e) => e!.trim().toLowerCase()),
    ),
  ];

  const result: { count: number }[] = await db.$queryRawUnsafe(
    `
    WITH expired AS (
      SELECT DISTINCT "threadId", "followUpSetAt"
      FROM "Message"
      WHERE "userId" = $1
        AND "followUpAt" <= NOW()
        AND "isFollowUp" = false
        AND "followUpAt" IS NOT NULL
        AND "threadId" IS NOT NULL
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
      )
    )
    UPDATE "Message" SET "isFollowUp" = true
    WHERE "userId" = $1
      AND "threadId" IN (SELECT "threadId" FROM no_reply)
      AND "followUpAt" IS NOT NULL
    `,
    userId,
    userEmails,
  );

  return result.length > 0 && "count" in result[0] ? result[0].count : 0;
}

export async function wakeExpiredSnoozes(userId: string): Promise<number> {
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
  return result.count;
}
