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

export function encodeCursor(msg: {
  isRead: boolean;
  receivedAt: Date;
  id: string;
}): string {
  return `${msg.isRead ? "1" : "0"}_${msg.receivedAt.toISOString()}_${msg.id}`;
}

export function parseCursor(cursor: string) {
  // Format: {0|1}_{isoDate}_{cuid}
  const firstUnderscore = cursor.indexOf("_");
  if (firstUnderscore === -1) return null;

  const isReadStr = cursor.substring(0, firstUnderscore);
  if (isReadStr !== "0" && isReadStr !== "1") return null;
  const isRead = isReadStr === "1";

  const rest = cursor.substring(firstUnderscore + 1);
  const lastUnderscore = rest.lastIndexOf("_");
  if (lastUnderscore === -1) return null;

  const dateStr = rest.substring(0, lastUnderscore);
  const id = rest.substring(lastUnderscore + 1);

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  if (!/^c[a-z0-9]{20,}$/.test(id)) return null;

  // Sort order: isRead ASC, receivedAt DESC, id DESC
  // "After this cursor" means items that sort later in this order.
  if (!isRead) {
    // Cursor is on an unread message. Next items:
    // - Unread messages older than cursor (same isRead, earlier receivedAt or same date + lower id)
    // - All read messages (isRead=true sorts after isRead=false)
    return {
      OR: [
        { isRead: false, receivedAt: { lt: date } },
        { isRead: false, receivedAt: date, id: { lt: id } },
        { isRead: true },
      ],
    };
  }

  // Cursor is on a read message. Next items:
  // - Read messages older than cursor
  return {
    OR: [
      { isRead: true, receivedAt: { lt: date } },
      { isRead: true, receivedAt: date, id: { lt: id } },
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
    orderBy: [{ isRead: "asc" }, { receivedAt: "desc" }, { id: "desc" }],
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
