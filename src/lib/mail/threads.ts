import { db } from "@/lib/db";

/**
 * For a list of messages, compute how many messages are in each thread.
 * Returns a Map from message ID to thread count.
 */
export async function getThreadCounts(
  userId: string,
  messages: { id: string; threadId: string | null }[]
): Promise<Map<string, number>> {
  const threadIds = messages
    .map((m) => m.threadId)
    .filter((id): id is string => id !== null);

  if (threadIds.length === 0) {
    return new Map();
  }

  const uniqueThreadIds = [...new Set(threadIds)];

  const counts = await db.message.groupBy({
    by: ["threadId"],
    where: {
      userId,
      threadId: { in: uniqueThreadIds },
    },
    _count: { id: true },
  });

  // Map threadId -> count
  const threadCountMap = new Map<string, number>();
  for (const row of counts) {
    if (row.threadId) {
      threadCountMap.set(row.threadId, row._count.id);
    }
  }

  // Map message ID -> count (via its threadId)
  const result = new Map<string, number>();
  for (const msg of messages) {
    if (msg.threadId) {
      result.set(msg.id, threadCountMap.get(msg.threadId) ?? 1);
    }
  }

  return result;
}

const threadInclude = {
  sender: { select: { displayName: true, email: true } },
  attachments: { select: { id: true, filename: true, size: true } },
} as const;

/**
 * Fetch all messages in a thread, given any message ID in that thread.
 * Uses a two-pass approach to find sent messages whose parent (inReplyTo)
 * may not be in the DB (e.g. deleted from inbox before sync).
 */
export async function getThreadMessages(userId: string, messageId: string) {
  // Get the target message
  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: {
      id: true,
      threadId: true,
      messageId: true,
      inReplyTo: true,
      references: true,
      subject: true,
    },
  });

  if (!message) return null;

  // Collect all related RFC message IDs for thread lookup
  const relatedIds = new Set<string>();
  if (message.threadId) relatedIds.add(message.threadId);
  if (message.messageId) relatedIds.add(message.messageId);
  if (message.inReplyTo) relatedIds.add(message.inReplyTo);
  for (const ref of message.references) {
    relatedIds.add(ref);
  }

  // Pass 1: find messages by threadId + relatedIds
  const pass1 = await db.message.findMany({
    where: {
      userId,
      OR: [
        ...(message.threadId ? [{ threadId: message.threadId }] : []),
        ...(relatedIds.size > 0
          ? [
              { messageId: { in: Array.from(relatedIds) } },
              { inReplyTo: { in: Array.from(relatedIds) } },
            ]
          : []),
        { id: messageId },
      ],
    },
    include: threadInclude,
    orderBy: { receivedAt: "asc" },
  });

  // Collect all messageIds found so far
  const foundIds = new Set(pass1.map((m) => m.id));
  const allMessageIds = pass1
    .map((m) => m.messageId)
    .filter((id): id is string => id !== null);

  // Pass 2: find messages that reply to any message in the thread
  // (catches sent messages whose threadId wasn't unified)
  let allMessages = pass1;
  if (allMessageIds.length > 0) {
    const pass2 = await db.message.findMany({
      where: {
        userId,
        inReplyTo: { in: allMessageIds },
        id: { notIn: Array.from(foundIds) },
      },
      include: threadInclude,
      orderBy: { receivedAt: "asc" },
    });

    if (pass2.length > 0) {
      allMessages = [...pass1, ...pass2];
    }
  }

  // Deduplicate: same messageId can exist in multiple folders (e.g. inbox + sent).
  // Prefer IMAP-synced records (positive UID) over local placeholders (negative UID).
  const seen = new Map<string, (typeof allMessages)[0]>();
  for (const m of allMessages) {
    if (!m.messageId) continue;
    const existing = seen.get(m.messageId);
    if (!existing || (existing.uid < 0 && m.uid >= 0)) {
      seen.set(m.messageId, m);
    }
  }
  const deduped = allMessages.filter(
    (m) => !m.messageId || seen.get(m.messageId) === m
  );

  // Mark unread messages as read
  const unreadMessages = deduped.filter((m) => !m.isRead);
  if (unreadMessages.length > 0) {
    await db.message.updateMany({
      where: { id: { in: unreadMessages.map((m) => m.id) } },
      data: { isRead: true },
    });
    const { revalidateTag } = await import("next/cache");
    revalidateTag("sidebar-counts");
  }

  // Sort by sentAt (envelope Date header) with receivedAt fallback
  const sorted = [...deduped].sort(
    (a, b) =>
      (a.sentAt ?? a.receivedAt).getTime() -
      (b.sentAt ?? b.receivedAt).getTime()
  );

  return {
    messages: sorted,
    markedRead: unreadMessages.map((m) => ({ uid: m.uid, folderId: m.folderId })),
  };
}

/**
 * Collapse a list of messages into one row per thread.
 * Keeps the latest message (assumes input is sorted by receivedAt desc).
 * Marks the thread row as unread if ANY message in the thread is unread.
 */
export function collapseToThreads<
  T extends { id: string; threadId: string | null; isRead: boolean },
>(messages: T[]): T[] {
  const threadMap = new Map<string, T>();
  const hasUnread = new Set<string>();

  for (const msg of messages) {
    const key = msg.threadId || msg.id;

    if (!msg.isRead) {
      hasUnread.add(key);
    }

    // First occurrence = latest (input is sorted desc)
    if (!threadMap.has(key)) {
      threadMap.set(key, msg);
    }
  }

  // Propagate unread status to the representative message
  return Array.from(threadMap.values()).map((msg) => {
    const key = msg.threadId || msg.id;
    if (hasUnread.has(key) && msg.isRead) {
      return { ...msg, isRead: false };
    }
    return msg;
  });
}
