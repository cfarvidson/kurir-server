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
