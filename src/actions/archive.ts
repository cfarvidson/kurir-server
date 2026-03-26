"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withImapConnection, findArchiveMailbox } from "@/lib/mail/imap-client";
import { suppressEcho } from "@/lib/mail/flag-push";

/**
 * Find PENDING senders linked to the given messages. If all of a sender's
 * messages are now archived, auto-reject the sender so they don't
 * reappear in the Screener when new mail arrives.
 */
async function autoRejectFullyArchivedSenders(messageIds: string[]) {
  const affectedMessages = await db.message.findMany({
    where: { id: { in: messageIds }, senderId: { not: null } },
    select: { senderId: true },
    distinct: ["senderId"],
  });

  const senderIds = affectedMessages
    .map((m) => m.senderId)
    .filter((id): id is string => id !== null);

  if (senderIds.length === 0) return;

  // Single query: find which senders still have non-archived messages
  const sendersWithNonArchived = await db.message.findMany({
    where: {
      senderId: { in: senderIds },
      isArchived: false,
    },
    select: { senderId: true },
    distinct: ["senderId"],
  });

  const keepSet = new Set(sendersWithNonArchived.map((m) => m.senderId));
  const rejectIds = senderIds.filter((id) => !keepSet.has(id));

  if (rejectIds.length > 0) {
    await db.sender.updateMany({
      where: { id: { in: rejectIds }, status: "PENDING" },
      data: { status: "REJECTED", decidedAt: new Date() },
    });
  }
}

function categoryToPath(category: string | null | undefined): string {
  switch (category) {
    case "FEED":
      return "/feed";
    case "PAPER_TRAIL":
      return "/paper-trail";
    default:
      return "/imbox";
  }
}

export async function moveToArchiveViaImap(
  userId: string,
  connectionId: string,
  folderId: string,
  uids: number[],
) {
  for (const uid of uids) {
    suppressEcho(userId, folderId, uid);
  }

  const result = await withImapConnection(connectionId, async (client) => {
    const mailboxes = await client.list();
    const archiveBox = findArchiveMailbox(mailboxes);

    if (archiveBox) {
      console.log(
        `[imap] Moving ${uids.length} message(s) to ${archiveBox.path}`,
      );
      const lock = await client.getMailboxLock("INBOX");
      try {
        const BATCH_SIZE = 100;
        for (let i = 0; i < uids.length; i += BATCH_SIZE) {
          const chunk = uids.slice(i, i + BATCH_SIZE);
          try {
            await client.messageMove(chunk, archiveBox.path, {
              uid: true,
            });
          } catch (err) {
            console.error(
              `[imap] Failed to move UIDs ${chunk.join(",")}:`,
              err,
            );
          }
        }
      } finally {
        lock.release();
      }
    } else {
      console.warn(
        `[imap] No archive folder found. Available: ${mailboxes.map((mb) => `${mb.path} (${mb.specialUse || "no special use"})`).join(", ")}`,
      );
    }
  });

  if (result === null) {
    console.warn(
      `[imap] moveToArchiveViaImap failed: IMAP connection returned null for ${uids.length} message(s)`,
    );
  }
}

export async function moveToInboxViaImap(
  userId: string,
  connectionId: string,
  folderId: string,
  uids: number[],
) {
  for (const uid of uids) {
    suppressEcho(userId, folderId, uid);
  }

  await withImapConnection(connectionId, async (client) => {
    const mailboxes = await client.list();
    const archiveBox = findArchiveMailbox(mailboxes);

    if (archiveBox) {
      const lock = await client.getMailboxLock(archiveBox.path);
      try {
        const BATCH_SIZE = 100;
        for (let i = 0; i < uids.length; i += BATCH_SIZE) {
          const chunk = uids.slice(i, i + BATCH_SIZE);
          try {
            await client.messageMove(chunk, "INBOX", { uid: true });
          } catch {
            // Batch may partially fail; messages may already be moved
          }
        }
      } finally {
        lock.release();
      }
    }
  });
}

export async function archiveConversation(
  messageId: string,
  sourcePath?: string,
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;

  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: {
      id: true,
      threadId: true,
      emailConnectionId: true,
      uid: true,
      folderId: true,
    },
  });

  if (!message) throw new Error("Message not found");

  const connectionId = message.emailConnectionId;

  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true, uid: true, folderId: true },
      })
    : [{ id: message.id, uid: message.uid, folderId: message.folderId }];

  const inboxFolder = await db.folder.findFirst({
    where: { emailConnectionId: connectionId, specialUse: "inbox" },
    select: { id: true },
  });

  const inboxMessageUids = inboxFolder
    ? threadMessages
        .filter((m) => m.folderId === inboxFolder.id && m.uid > 0)
        .map((m) => m.uid)
    : [];

  // DB update + revalidation first
  const messageIds = threadMessages.map((m) => m.id);
  await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: {
      isArchived: true,
      isInImbox: false,
      isInFeed: false,
      isInPaperTrail: false,
      isInScreener: false,
      isSnoozed: false,
      snoozedUntil: null,
    },
  });

  await autoRejectFullyArchivedSenders(messageIds);

  revalidateTag("sidebar-counts");
  revalidatePath("/archive");
  if (sourcePath) {
    const basePath = sourcePath.split("?")[0];
    revalidatePath(basePath);
  }

  // Defer IMAP to after response
  if (inboxMessageUids.length > 0 && inboxFolder) {
    after(() =>
      moveToArchiveViaImap(
        userId,
        connectionId,
        inboxFolder.id,
        inboxMessageUids,
      ).catch((err) => console.error("IMAP archive move failed:", err)),
    );
  }
}

export async function archiveConversations(
  messageIds: string[],
  sourcePath?: string,
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;

  const messages = await db.message.findMany({
    where: { id: { in: messageIds }, userId },
    select: { id: true, threadId: true, emailConnectionId: true },
  });

  if (messages.length === 0) return;

  const threadIds = [
    ...new Set(messages.map((m) => m.threadId).filter(Boolean)),
  ] as string[];
  const singleIds = messages.filter((m) => !m.threadId).map((m) => m.id);

  const threadMessages = await db.message.findMany({
    where: {
      userId,
      OR: [
        ...(threadIds.length > 0 ? [{ threadId: { in: threadIds } }] : []),
        ...(singleIds.length > 0 ? [{ id: { in: singleIds } }] : []),
      ],
    },
    select: { id: true, uid: true, folderId: true, emailConnectionId: true },
  });

  // Pre-compute IMAP work per connection
  const byConnection = new Map<string, typeof threadMessages>();
  for (const msg of threadMessages) {
    const group = byConnection.get(msg.emailConnectionId) ?? [];
    group.push(msg);
    byConnection.set(msg.emailConnectionId, group);
  }

  const imapWork: Array<{
    connectionId: string;
    folderId: string;
    uids: number[];
  }> = [];

  for (const [connectionId, connMessages] of byConnection) {
    const inboxFolder = await db.folder.findFirst({
      where: { emailConnectionId: connectionId, specialUse: "inbox" },
      select: { id: true },
    });

    const uids = inboxFolder
      ? connMessages
          .filter((m) => m.folderId === inboxFolder.id && m.uid > 0)
          .map((m) => m.uid)
      : [];

    if (uids.length > 0 && inboxFolder) {
      imapWork.push({ connectionId, folderId: inboxFolder.id, uids });
    }
  }

  // DB update + revalidation first
  const allMessageIds = threadMessages.map((m) => m.id);
  await db.message.updateMany({
    where: { id: { in: allMessageIds } },
    data: {
      isArchived: true,
      isInImbox: false,
      isInFeed: false,
      isInPaperTrail: false,
      isInScreener: false,
      isSnoozed: false,
      snoozedUntil: null,
    },
  });

  await autoRejectFullyArchivedSenders(allMessageIds);

  revalidateTag("sidebar-counts");
  revalidatePath("/archive");
  if (sourcePath) {
    const basePath = sourcePath.split("?")[0];
    revalidatePath(basePath);
  }

  // Defer IMAP to after response
  if (imapWork.length > 0) {
    after(async () => {
      for (const { connectionId, folderId, uids } of imapWork) {
        await moveToArchiveViaImap(userId, connectionId, folderId, uids).catch(
          (err) => console.error("IMAP archive move failed:", err),
        );
      }
    });
  }
}

export async function unarchiveConversation(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;

  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: {
      id: true,
      threadId: true,
      emailConnectionId: true,
      uid: true,
      folderId: true,
      sender: { select: { category: true } },
    },
  });

  if (!message) throw new Error("Message not found");

  const connectionId = message.emailConnectionId;

  const category = message.sender?.category ?? "IMBOX";
  const categoryFlags = {
    isInImbox: category === "IMBOX",
    isInFeed: category === "FEED",
    isInPaperTrail: category === "PAPER_TRAIL",
  };

  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true, uid: true, folderId: true },
      })
    : [{ id: message.id, uid: message.uid, folderId: message.folderId }];

  const archiveFolder = await db.folder.findFirst({
    where: {
      emailConnectionId: connectionId,
      specialUse: { in: ["archive", "all"] },
    },
    select: { id: true },
  });

  const archiveMessageUids = archiveFolder
    ? threadMessages
        .filter((m) => m.folderId === archiveFolder.id && m.uid > 0)
        .map((m) => m.uid)
    : [];

  // DB update + revalidation first
  const messageIds = threadMessages.map((m) => m.id);
  await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: {
      isArchived: false,
      isInImbox: categoryFlags.isInImbox,
      isInFeed: categoryFlags.isInFeed,
      isInPaperTrail: categoryFlags.isInPaperTrail,
      isInScreener: false,
    },
  });

  revalidateTag("sidebar-counts");
  revalidatePath(categoryToPath(category));

  // Defer IMAP to after response
  if (archiveMessageUids.length > 0 && archiveFolder) {
    after(() =>
      moveToInboxViaImap(
        userId,
        connectionId,
        archiveFolder.id,
        archiveMessageUids,
      ).catch((err) => console.error("IMAP unarchive move failed:", err)),
    );
  }
}

export async function unarchiveConversations(messageIds: string[]) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;

  const messages = await db.message.findMany({
    where: { id: { in: messageIds }, userId },
    select: {
      id: true,
      threadId: true,
      emailConnectionId: true,
      sender: { select: { category: true } },
    },
  });

  if (messages.length === 0) return;

  const threadIds = [
    ...new Set(messages.map((m) => m.threadId).filter(Boolean)),
  ] as string[];
  const singleIds = messages.filter((m) => !m.threadId).map((m) => m.id);

  const threadMessages = await db.message.findMany({
    where: {
      userId,
      OR: [
        ...(threadIds.length > 0 ? [{ threadId: { in: threadIds } }] : []),
        ...(singleIds.length > 0 ? [{ id: { in: singleIds } }] : []),
      ],
    },
    select: {
      id: true,
      uid: true,
      folderId: true,
      emailConnectionId: true,
      sender: { select: { category: true } },
    },
  });

  // Group by sender category for DB updates
  const byCat = new Map<string, string[]>();
  for (const msg of threadMessages) {
    const cat = msg.sender?.category ?? "IMBOX";
    const ids = byCat.get(cat) ?? [];
    ids.push(msg.id);
    byCat.set(cat, ids);
  }

  for (const [cat, ids] of byCat) {
    await db.message.updateMany({
      where: { id: { in: ids } },
      data: {
        isArchived: false,
        isInImbox: cat === "IMBOX",
        isInFeed: cat === "FEED",
        isInPaperTrail: cat === "PAPER_TRAIL",
        isInScreener: false,
      },
    });
  }

  revalidateTag("sidebar-counts");
  revalidatePath("/archive");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");

  // Pre-compute IMAP work per connection
  const byConnection = new Map<string, typeof threadMessages>();
  for (const msg of threadMessages) {
    const group = byConnection.get(msg.emailConnectionId) ?? [];
    group.push(msg);
    byConnection.set(msg.emailConnectionId, group);
  }

  const imapWork: Array<{
    connectionId: string;
    folderId: string;
    uids: number[];
  }> = [];

  for (const [connectionId, connMessages] of byConnection) {
    const archiveFolder = await db.folder.findFirst({
      where: {
        emailConnectionId: connectionId,
        specialUse: { in: ["archive", "all"] },
      },
      select: { id: true },
    });

    const uids = archiveFolder
      ? connMessages
          .filter((m) => m.folderId === archiveFolder.id && m.uid > 0)
          .map((m) => m.uid)
      : [];

    if (uids.length > 0 && archiveFolder) {
      imapWork.push({ connectionId, folderId: archiveFolder.id, uids });
    }
  }

  if (imapWork.length > 0) {
    after(async () => {
      for (const { connectionId, folderId, uids } of imapWork) {
        await moveToInboxViaImap(userId, connectionId, folderId, uids).catch(
          (err) => console.error("IMAP unarchive move failed:", err),
        );
      }
    });
  }
}
