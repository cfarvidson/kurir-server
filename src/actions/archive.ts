"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withImapConnection } from "@/lib/mail/imap-client";
import { suppressEcho } from "@/lib/mail/flag-push";

export async function archiveConversation(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;

  // Find the target message and its threadId
  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: { id: true, threadId: true },
  });

  if (!message) {
    throw new Error("Message not found");
  }

  // Find all messages in this thread
  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true, uid: true, folderId: true },
      })
    : [{ id: message.id, uid: 0, folderId: "" }];

  // Get inbox folder to identify which messages need IMAP move
  const inboxFolder = await db.folder.findFirst({
    where: { userId, specialUse: "inbox" },
    select: { id: true },
  });

  const inboxMessageUids = inboxFolder
    ? threadMessages
        .filter((m) => m.folderId === inboxFolder.id && m.uid > 0)
        .map((m) => m.uid)
    : [];

  // Move messages on IMAP if there are inbox messages to move
  if (inboxMessageUids.length > 0) {
    // Register echo suppression before IMAP move (prevents IDLE re-processing)
    for (const uid of inboxMessageUids) {
      suppressEcho(userId, inboxFolder!.id, uid);
    }

    await withImapConnection(userId, async (client) => {
      const mailboxes = await client.list();
      const archiveBox = mailboxes.find(
        (mb) =>
          mb.specialUse === "\\Archive" ||
          mb.path.toLowerCase() === "archive"
      );

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

  // Update all thread messages in DB
  const messageIds = threadMessages.map((m) => m.id);
  await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: {
      isArchived: true,
      isInImbox: false,
      isInFeed: false,
      isInPaperTrail: false,
      isInScreener: false,
    },
  });

  revalidateTag("sidebar-counts");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
  revalidatePath("/archive");
}

export async function unarchiveConversation(messageId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;

  // Find the target message with its sender to auto-detect destination
  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    select: {
      id: true,
      threadId: true,
      sender: { select: { category: true } },
    },
  });

  if (!message) {
    throw new Error("Message not found");
  }

  // Auto-detect destination from sender's current category
  const category = message.sender?.category ?? "IMBOX";
  const categoryFlags = {
    isInImbox: category === "IMBOX",
    isInFeed: category === "FEED",
    isInPaperTrail: category === "PAPER_TRAIL",
  };

  // Find all messages in this thread
  const threadMessages = message.threadId
    ? await db.message.findMany({
        where: { userId, threadId: message.threadId },
        select: { id: true, uid: true, folderId: true },
      })
    : [{ id: message.id, uid: 0, folderId: "" }];

  // Get archive folder to identify which messages need IMAP move back
  const archiveFolder = await db.folder.findFirst({
    where: { userId, specialUse: "archive" },
    select: { id: true },
  });

  const archiveMessageUids = archiveFolder
    ? threadMessages
        .filter((m) => m.folderId === archiveFolder.id && m.uid > 0)
        .map((m) => m.uid)
    : [];

  // Move messages back to INBOX on IMAP
  // Note: IMAP has no concept of Imbox/Feed/Paper Trail — those are app-level categories.
  // All unarchived messages go back to INBOX. UIDs will change after move;
  // next sync reconciles via message-ID dedup.
  if (archiveMessageUids.length > 0) {
    // Register echo suppression before IMAP move
    for (const uid of archiveMessageUids) {
      suppressEcho(userId, archiveFolder!.id, uid);
    }

    await withImapConnection(userId, async (client) => {
      const mailboxes = await client.list();
      const archiveBox = mailboxes.find(
        (mb) =>
          mb.specialUse === "\\Archive" ||
          mb.path.toLowerCase() === "archive"
      );

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

  // Update all thread messages in DB
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
