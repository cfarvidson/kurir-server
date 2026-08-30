import { db } from "@/lib/db";
import { collapseToThreads, getThreadCounts } from "@/lib/mail/threads";

/** All-mail: from or to this person, including Archive. No list filter. */
export function personHistoryWhere(userId: string, emails: string[]) {
  const variants = [
    ...new Set(
      emails.flatMap((email) => {
        const trimmed = email.trim();
        if (!trimmed) return [];
        const lower = trimmed.toLowerCase();
        return trimmed === lower ? [trimmed] : [trimmed, lower];
      }),
    ),
  ];
  return {
    userId,
    OR: [
      ...variants.map((email) => ({
        fromAddress: { equals: email, mode: "insensitive" as const },
      })),
      { toAddresses: { hasSome: variants } },
    ],
  };
}

export async function conversationsForEmails(
  userId: string,
  emails: string[],
) {
  if (emails.length === 0) return [];

  const messages = await db.message.findMany({
    where: personHistoryWhere(userId, emails),
    include: {
      sender: { select: { displayName: true, email: true, unthread: true } },
      attachments: { select: { id: true } },
    },
    orderBy: { receivedAt: "desc" },
  });

  const collapsed = collapseToThreads(messages);
  const threadCounts = await getThreadCounts(userId, collapsed);

  return collapsed.map((msg) => ({
    ...msg,
    threadCount: threadCounts.get(msg.id) ?? 1,
    hasAttachments: msg.attachments.length > 0,
  }));
}
