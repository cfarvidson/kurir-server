import { db } from "@/lib/db";
import { collapseToThreads, getThreadCounts } from "@/lib/mail/threads";

export async function getContactContext(userId: string, email: string) {
  const [sender, dateRange, recentMessages] = await Promise.all([
    db.sender.findFirst({
      where: { userId, email },
    }),
    db.message.aggregate({
      where: { userId, fromAddress: email },
      _min: { receivedAt: true },
      _max: { receivedAt: true },
    }),
    db.message.findMany({
      where: {
        userId,
        OR: [{ fromAddress: email }, { toAddresses: { has: email } }],
      },
      select: {
        id: true,
        subject: true,
        receivedAt: true,
        threadId: true,
        isRead: true,
        isInImbox: true,
        isInFeed: true,
        isInPaperTrail: true,
        isArchived: true,
        hasAttachments: true,
        sender: { select: { displayName: true, email: true } },
      },
      orderBy: { receivedAt: "desc" },
      take: 50, // fetch enough to get 5 unique threads
    }),
  ]);

  const collapsed = collapseToThreads(recentMessages);
  const threads = collapsed.slice(0, 5);
  const threadCounts = await getThreadCounts(userId, threads);

  return {
    sender,
    firstEmailAt: dateRange._min.receivedAt,
    lastEmailAt: dateRange._max.receivedAt,
    recentThreads: threads.map((t) => ({
      id: t.id,
      subject: t.subject,
      receivedAt: t.receivedAt,
      threadCount: threadCounts.get(t.id) ?? 1,
      hasAttachments: t.hasAttachments,
      isInImbox: t.isInImbox,
      isInFeed: t.isInFeed,
      isInPaperTrail: t.isInPaperTrail,
      isArchived: t.isArchived,
    })),
  };
}

// getThreadRoute moved to @/lib/mail/route-helpers (client-safe)
