import { db } from "@/lib/db";
import { collapseToThreads, getThreadCounts } from "@/lib/mail/threads";

export interface ContactContextOptions {
  /**
   * In-pane conversation search (kurir-ios#115): narrows the conversations
   * to threads whose subject or snippet contains the text. Every list is
   * searched, Archive included. Blank means the full history.
   */
  q?: string | null;
  /** Threads to return; the pane shows more than the old thread column. */
  limit?: number;
}

export const CONTACT_CONTEXT_THREAD_LIMIT = 8;

/** Mail exchanged with `email` across all lists, optionally filtered by `q`. */
export function contactConversationWhere(
  userId: string,
  email: string,
  q?: string | null,
) {
  const where: {
    userId: string;
    OR: ({ fromAddress: string } | { toAddresses: { has: string } })[];
    AND?: {
      OR: (
        | { subject: { contains: string; mode: "insensitive" } }
        | { snippet: { contains: string; mode: "insensitive" } }
      )[];
    };
  } = {
    userId,
    OR: [{ fromAddress: email }, { toAddresses: { has: email } }],
  };
  const query = q?.trim();
  if (query) {
    where.AND = {
      OR: [
        { subject: { contains: query, mode: "insensitive" } },
        { snippet: { contains: query, mode: "insensitive" } },
      ],
    };
  }
  return where;
}

export async function getContactContext(
  userId: string,
  email: string,
  options: ContactContextOptions = {},
) {
  const limit = options.limit ?? CONTACT_CONTEXT_THREAD_LIMIT;
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
      where: contactConversationWhere(userId, email, options.q),
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
        sender: { select: { displayName: true, email: true, unthread: true } },
      },
      orderBy: { receivedAt: "desc" },
      take: Math.max(limit * 10, 50), // fetch enough to get `limit` unique threads
    }),
  ]);

  const collapsed = collapseToThreads(recentMessages);
  const threads = collapsed.slice(0, limit);
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

export type ContactContext = Awaited<ReturnType<typeof getContactContext>>;

// getThreadRoute moved to @/lib/mail/route-helpers (client-safe)
