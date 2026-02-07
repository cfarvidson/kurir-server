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
