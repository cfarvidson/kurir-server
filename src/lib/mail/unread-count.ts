import { db } from "@/lib/db";

export interface UnreadRow {
  id: string;
  threadId: string | null;
  unthread: boolean;
}

/**
 * Same thread-key rule as the web's collapse and the iOS clients
 * (MailStore.collapse / BadgeCountStore.unreadThreadCount):
 * threadId ?? id, own id when the sender is unthreaded.
 */
export function countUnreadThreads(rows: UnreadRow[]): number {
  const keys = new Set<string>();
  for (const row of rows) {
    keys.add(row.unthread ? row.id : (row.threadId ?? row.id));
  }
  return keys.size;
}

/** Unread Imbox thread count for the app-icon badge (aps.badge). */
export async function getImboxUnreadThreadCount(
  userId: string,
): Promise<number> {
  const rows = await db.message.findMany({
    where: {
      userId,
      isInImbox: true,
      isSnoozed: false,
      isReplyLater: false,
      isRead: false,
      isDeleted: false,
    },
    select: {
      id: true,
      threadId: true,
      sender: { select: { unthread: true } },
    },
  });
  return countUnreadThreads(
    rows.map((r) => ({
      id: r.id,
      threadId: r.threadId,
      unthread: r.sender?.unthread ?? false,
    })),
  );
}
