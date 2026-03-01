"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withImapConnection } from "@/lib/mail/imap-client";
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

  const pendingSenders = await db.sender.findMany({
    where: { id: { in: senderIds }, status: "PENDING" },
    select: { id: true },
  });

  for (const sender of pendingSenders) {
    const hasNonArchived = await db.message.findFirst({
      where: { senderId: sender.id, isArchived: false },
      select: { id: true },
    });

    if (!hasNonArchived) {
      await db.sender.update({
        where: { id: sender.id },
        data: { status: "REJECTED", decidedAt: new Date() },
      });
    }
  }
}

export async function archiveConversation(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;

  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: { id: true, threadId: true, emailConnectionId: true },
  });

  if (!message) {
    throw new Error("Message not found");
  }

  const connectionId = message.emailConnectionId;

  // Find all messages in this thread
  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true, uid: true, folderId: true },
      })
    : [{ id: message.id, uid: 0, folderId: "" }];

  // Get inbox folder scoped to this connection
  const inboxFolder = await db.folder.findFirst({
    where: { emailConnectionId: connectionId, specialUse: "inbox" },
    select: { id: true },
  });

  const inboxMessageUids = inboxFolder
    ? threadMessages
        .filter((m) => m.folderId === inboxFolder.id && m.uid > 0)
        .map((m) => m.uid)
    : [];

  if (inboxMessageUids.length > 0) {
    for (const uid of inboxMessageUids) {
      suppressEcho(userId, inboxFolder!.id, uid);
    }

    await withImapConnection(connectionId, async (client) => {
      const mailboxes = await client.list();
      const archiveBox =
        mailboxes.find(
          (mb) =>
            mb.specialUse === "\\Archive" ||
            mb.path.toLowerCase() === "archive"
        ) ?? mailboxes.find((mb) => mb.specialUse === "\\All");

      if (archiveBox) {
        const lock = await client.getMailboxLock("INBOX");
        try {
          for (const uid of inboxMessageUids) {
            try {
              await client.messageMove(String(uid), archiveBox.path, {
                uid: true,
              });
            } catch {
              // Message may already be moved or deleted, continue
            }
          }
        } finally {
          lock.release();
        }
      }
    });
  }

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
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/archive");
  revalidatePath("/screener");
}

export async function archiveConversations(messageIds: string[]) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;

  const messages = await db.message.findMany({
    where: { id: { in: messageIds }, userId },
    select: { id: true, threadId: true, emailConnectionId: true },
  });

  if (messages.length === 0) return;

  // Collect all thread messages across all selected threads
  const threadIds = [
    ...new Set(messages.map((m) => m.threadId).filter(Boolean)),
  ] as string[];
  const singleIds = messages
    .filter((m) => !m.threadId)
    .map((m) => m.id);

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

  // Group by connection so each uses the right IMAP credentials
  const byConnection = new Map<string, typeof threadMessages>();
  for (const msg of threadMessages) {
    const group = byConnection.get(msg.emailConnectionId) ?? [];
    group.push(msg);
    byConnection.set(msg.emailConnectionId, group);
  }

  for (const [connectionId, connMessages] of byConnection) {
    const inboxFolder = await db.folder.findFirst({
      where: { emailConnectionId: connectionId, specialUse: "inbox" },
      select: { id: true },
    });

    const inboxMessageUids = inboxFolder
      ? connMessages
          .filter((m) => m.folderId === inboxFolder.id && m.uid > 0)
          .map((m) => m.uid)
      : [];

    if (inboxMessageUids.length > 0) {
      for (const uid of inboxMessageUids) {
        suppressEcho(userId, inboxFolder!.id, uid);
      }

      await withImapConnection(connectionId, async (client) => {
        const mailboxes = await client.list();
        const archiveBox =
          mailboxes.find(
            (mb) =>
              mb.specialUse === "\\Archive" ||
              mb.path.toLowerCase() === "archive"
          ) ?? mailboxes.find((mb) => mb.specialUse === "\\All");

        if (archiveBox) {
          const lock = await client.getMailboxLock("INBOX");
          try {
            for (const uid of inboxMessageUids) {
              try {
                await client.messageMove(String(uid), archiveBox.path, {
                  uid: true,
                });
              } catch {
                // Message may already be moved or deleted, continue
              }
            }
          } finally {
            lock.release();
          }
        }
      });
    }
  }

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
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/archive");
  revalidatePath("/screener");
}

export async function unarchiveConversation(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;

  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: {
      id: true,
      threadId: true,
      emailConnectionId: true,
      sender: { select: { category: true } },
    },
  });

  if (!message) {
    throw new Error("Message not found");
  }

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
    : [{ id: message.id, uid: 0, folderId: "" }];

  const archiveFolder = await db.folder.findFirst({
    where: { emailConnectionId: connectionId, specialUse: { in: ["archive", "all"] } },
    select: { id: true },
  });

  const archiveMessageUids = archiveFolder
    ? threadMessages
        .filter((m) => m.folderId === archiveFolder.id && m.uid > 0)
        .map((m) => m.uid)
    : [];

  if (archiveMessageUids.length > 0) {
    for (const uid of archiveMessageUids) {
      suppressEcho(userId, archiveFolder!.id, uid);
    }

    await withImapConnection(connectionId, async (client) => {
      const mailboxes = await client.list();
      const archiveBox =
        mailboxes.find(
          (mb) =>
            mb.specialUse === "\\Archive" ||
            mb.path.toLowerCase() === "archive"
        ) ?? mailboxes.find((mb) => mb.specialUse === "\\All");

      if (archiveBox) {
        const lock = await client.getMailboxLock(archiveBox.path);
        try {
          for (const uid of archiveMessageUids) {
            try {
              await client.messageMove(String(uid), "INBOX", { uid: true });
            } catch {
              // Message may already be moved or deleted, continue
            }
          }
        } finally {
          lock.release();
        }
      }
    });
  }

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
  revalidatePath("/archive");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
}
