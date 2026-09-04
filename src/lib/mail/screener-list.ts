import { db } from "@/lib/db";

export const SCREENED_SENDERS_TAKE = 200;

export async function getScreenedSenders(
  userId: string,
  ownEmails?: string[],
) {
  return db.sender.findMany({
    where: {
      userId,
      status: { in: ["APPROVED", "REJECTED"] },
      ...(ownEmails?.length ? { NOT: { email: { in: ownEmails } } } : {}),
    },
    orderBy: { decidedAt: "desc" },
    take: SCREENED_SENDERS_TAKE,
    select: {
      id: true,
      email: true,
      displayName: true,
      domain: true,
      status: true,
      category: true,
      decidedAt: true,
      messageCount: true,
    },
  });
}
