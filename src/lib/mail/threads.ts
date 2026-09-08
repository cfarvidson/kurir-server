import { db } from "@/lib/db";
import { threadKeyOf } from "@/lib/mail/thread-key";
import { getThreadRoute } from "@/lib/mail/route-helpers";
import { nudgeIosClients } from "@/lib/mail/push-sender";

export { threadKeyOf };

/**
 * For a list of messages, compute how many messages are in each thread.
 * Returns a Map from message ID to thread count.
 */
export async function getThreadCounts(
  userId: string,
  messages: { id: string; threadId: string | null }[],
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
  sender: {
    select: {
      id: true,
      displayName: true,
      email: true,
      unthread: true,
      allowRemoteImages: true,
    },
  },
  attachments: {
    select: {
      id: true,
      filename: true,
      size: true,
      contentId: true,
      contentType: true,
    },
  },
  meeting: {
    select: {
      method: true,
      title: true,
      startAt: true,
      endAt: true,
      isAllDay: true,
      location: true,
      organizerName: true,
      organizerEmail: true,
      calendarEventId: true,
      calendarEvent: {
        select: { attendeesJson: true },
      },
    },
  },
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
      splitFromThreadId: true,
      messageId: true,
      inReplyTo: true,
      references: true,
      subject: true,
      sender: { select: { unthread: true } },
    },
  });

  if (!message) return null;

  // A branch thread (plan 055) is exactly its threadId rows. Its References
  // still name the broadcast it split from and the broadcast's other replies,
  // so the linkage passes below would merge it straight back — skip them.
  if (message.splitFromThreadId && message.threadId) {
    const branch = await db.message.findMany({
      where: { userId, threadId: message.threadId },
      include: threadInclude,
      orderBy: { receivedAt: "asc" },
    });
    return finalizeThread(branch);
  }

  // When the sender is flagged `unthread`, render only this message in the
  // detail view — do not pull in related messages by threadId/References.
  if (message.sender?.unthread) {
    const only = await db.message.findMany({
      where: { id: messageId, userId },
      include: threadInclude,
    });

    const unreadMessages = only.filter((m) => !m.isRead);
    if (unreadMessages.length > 0) {
      await db.message.updateMany({
        where: { id: { in: unreadMessages.map((m) => m.id) } },
        data: { isRead: true },
      });
      nudgeIosClients(
        userId,
        unreadMessages.map((m) => m.id),
      );
    }

    return {
      messages: only,
      markedRead: unreadMessages.map((m) => ({
        uid: m.uid,
        folderId: m.folderId,
      })),
    };
  }

  // Collect all related RFC message IDs for thread lookup
  const relatedIds = new Set<string>();
  if (message.threadId) relatedIds.add(message.threadId);
  if (message.messageId) relatedIds.add(message.messageId);
  if (message.inReplyTo) relatedIds.add(message.inReplyTo);
  for (const ref of message.references) {
    relatedIds.add(ref);
  }

  // Pass 1: find messages by threadId + relatedIds. Branch rows are never
  // linked in: they reply to this thread's messages by design.
  const pass1 = await db.message.findMany({
    where: {
      userId,
      splitFromThreadId: null,
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
        splitFromThreadId: null,
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

  return finalizeThread(allMessages);
}

type ThreadRow = Awaited<
  ReturnType<typeof db.message.findMany<{ include: typeof threadInclude }>>
>[number];

/** Dedupe folder copies, mark unread rows read, sort by Date header. */
async function finalizeThread(allMessages: ThreadRow[]) {
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
    (m) => !m.messageId || seen.get(m.messageId) === m,
  );

  // Mark unread messages as read
  const unreadMessages = deduped.filter((m) => !m.isRead);
  if (unreadMessages.length > 0) {
    await db.message.updateMany({
      where: { id: { in: unreadMessages.map((m) => m.id) } },
      data: { isRead: true },
    });
    const userId = deduped[0]?.userId;
    if (userId) {
      nudgeIosClients(
        userId,
        unreadMessages.map((m) => m.id),
      );
    }
    // Sidebar revalidation is handled by <SidebarRefresh /> in the page component
  }

  // Sort by sentAt (envelope Date header) with receivedAt fallback
  const sorted = [...deduped].sort(
    (a, b) =>
      (a.sentAt ?? a.receivedAt).getTime() -
      (b.sentAt ?? b.receivedAt).getTime(),
  );

  return {
    messages: sorted,
    markedRead: unreadMessages.map((m) => ({
      uid: m.uid,
      folderId: m.folderId,
    })),
  };
}

/**
 * Collapse a list of messages into one row per thread.
 * Keeps the latest message (assumes input is sorted by receivedAt desc).
 * Marks the thread row as unread if ANY message in the thread is unread.
 *
 * Messages whose sender is flagged `unthread` are rendered as standalone rows
 * (keyed by message id) instead of being grouped by threadId.
 */
export function collapseToThreads<
  T extends {
    id: string;
    threadId: string | null;
    isRead: boolean;
    sender?: { unthread?: boolean } | null;
  },
>(messages: T[]): T[] {
  const threadMap = new Map<string, T>();
  const hasUnread = new Set<string>();

  for (const msg of messages) {
    const key = threadKeyOf(msg);

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
    const key = threadKeyOf(msg);
    if (hasUnread.has(key) && msg.isRead) {
      return { ...msg, isRead: false };
    }
    return msg;
  });
}

export interface ThreadBranch {
  threadId: string;
  /** Route to open the branch (its latest message, like a list row). */
  href: string;
  senderName: string;
  count: number;
  latestAt: Date;
  /** RFC Message-ID of the broadcast message the branch replies to. */
  rootInReplyTo: string | null;
}

/**
 * Branch threads split from `threadId` (plan 055), one per counterpart,
 * oldest branch first. Empty when the thread is not a broadcast.
 */
export async function branchesOf(
  userId: string,
  threadId: string,
): Promise<ThreadBranch[]> {
  const rows = await db.message.findMany({
    where: { userId, splitFromThreadId: threadId },
    select: {
      id: true,
      threadId: true,
      messageId: true,
      inReplyTo: true,
      fromAddress: true,
      fromName: true,
      sentAt: true,
      receivedAt: true,
      isInImbox: true,
      isInFeed: true,
      isInPaperTrail: true,
      isArchived: true,
      sender: { select: { displayName: true } },
    },
    orderBy: { receivedAt: "asc" },
  });

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.threadId) continue;
    const group = groups.get(row.threadId) ?? [];
    group.push(row);
    groups.set(row.threadId, group);
  }

  const at = (m: (typeof rows)[number]) => (m.sentAt ?? m.receivedAt).getTime();
  const branches: ThreadBranch[] = [];
  for (const [branchThreadId, group] of groups) {
    const sorted = [...group].sort((a, b) => at(a) - at(b));
    const root =
      sorted.find((m) => m.messageId === branchThreadId) ?? sorted[0];
    const latest = sorted[sorted.length - 1];
    branches.push({
      threadId: branchThreadId,
      href: `${getThreadRoute(latest)}/${latest.id}`,
      senderName:
        root.sender?.displayName || root.fromName || root.fromAddress,
      count: sorted.length,
      latestAt: latest.sentAt ?? latest.receivedAt,
      rootInReplyTo: root.inReplyTo,
    });
  }
  return branches.sort((a, b) => {
    const ra = groups.get(a.threadId)!;
    const rb = groups.get(b.threadId)!;
    return Math.min(...ra.map(at)) - Math.min(...rb.map(at));
  });
}

export interface SplitOrigin {
  href: string;
  sentAt: Date;
}

/**
 * For a branch thread: the broadcast message it split from (plan 055), or
 * null when the thread is not a branch or the broadcast is gone.
 */
export async function splitOriginOf(
  userId: string,
  messages: Array<{
    threadId: string | null;
    splitFromThreadId: string | null;
    messageId: string | null;
    inReplyTo: string | null;
  }>,
): Promise<SplitOrigin | null> {
  const root =
    messages.find((m) => m.splitFromThreadId && m.messageId === m.threadId) ??
    messages.find((m) => m.splitFromThreadId);
  if (!root?.splitFromThreadId) return null;

  const select = {
    id: true,
    sentAt: true,
    receivedAt: true,
    isInImbox: true,
    isInFeed: true,
    isInPaperTrail: true,
    isArchived: true,
  } as const;
  const origin =
    (root.inReplyTo
      ? await db.message.findFirst({
          where: { userId, messageId: root.inReplyTo, splitFromThreadId: null },
          select,
        })
      : null) ??
    (await db.message.findFirst({
      where: { userId, threadId: root.splitFromThreadId },
      select,
      orderBy: { receivedAt: "asc" },
    }));
  if (!origin) return null;
  return {
    href: `${getThreadRoute(origin)}/${origin.id}`,
    sentAt: origin.sentAt ?? origin.receivedAt,
  };
}
