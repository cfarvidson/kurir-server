import { db } from "@/lib/db";
import { getUserEmails } from "@/lib/mail/user-emails";

export async function checkExpiredFollowUps(userId: string): Promise<number> {
  const userEmails = await getUserEmails(userId);

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
      )
    )
    UPDATE "Message" SET "isFollowUp" = true
    WHERE "userId" = $1
      AND "threadId" IN (SELECT "threadId" FROM no_reply)
      AND "followUpAt" IS NOT NULL
      AND "isArchived" = false
    `,
    userId,
    userEmails,
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
