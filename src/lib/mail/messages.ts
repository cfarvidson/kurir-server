import { db } from "@/lib/db";
import { getThreadCounts } from "@/lib/mail/threads";

const CATEGORY_FILTERS = {
  imbox: { isInImbox: true },
  feed: { isInFeed: true },
  "paper-trail": { isInPaperTrail: true },
} as const;

export const MESSAGE_SELECT = {
  id: true,
  subject: true,
  snippet: true,
  fromAddress: true,
  fromName: true,
  receivedAt: true,
  isRead: true,
  isFlagged: true,
  hasAttachments: true,
  threadId: true,
  sender: { select: { displayName: true, email: true } },
} as const;

export type Category = keyof typeof CATEGORY_FILTERS;

export function encodeCursor(msg: { receivedAt: Date; id: string }): string {
  return `${msg.receivedAt.toISOString()}_${msg.id}`;
}

export function parseCursor(cursor: string) {
  const lastUnderscore = cursor.lastIndexOf("_");
  if (lastUnderscore === -1) return null;

  const dateStr = cursor.substring(0, lastUnderscore);
  const id = cursor.substring(lastUnderscore + 1);

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  if (!/^c[a-z0-9]{20,}$/.test(id)) return null;

  return {
    OR: [
      { receivedAt: { lt: date } },
      { receivedAt: date, id: { lt: id } },
    ],
  };
}

export async function getMessages(
  userId: string,
  category: Category,
  limit: number,
  cursor?: string
) {
  const cursorCondition = cursor ? parseCursor(cursor) : undefined;
  if (cursor && !cursorCondition) return null;

  const messages = await db.message.findMany({
    where: {
      userId,
      ...CATEGORY_FILTERS[category],
      ...cursorCondition,
    },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: MESSAGE_SELECT,
  });

  const threadCounts = await getThreadCounts(userId, messages);

  const withCounts = messages.map((m) => ({
    ...m,
    threadCount: threadCounts.get(m.id) ?? 1,
  }));

  const nextCursor =
    messages.length === limit
      ? encodeCursor(messages[messages.length - 1])
      : null;

  return { messages: withCounts, nextCursor };
}
