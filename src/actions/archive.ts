"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { ImapFlow } from "imapflow";
import { auth, getUserCredentials } from "@/lib/auth";
import { db } from "@/lib/db";

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
    const credentials = await getUserCredentials(userId);
    if (credentials) {
      const client = new ImapFlow({
        host: credentials.imap.host,
        port: credentials.imap.port,
        secure: true,
        auth: {
          user: credentials.email,
          pass: credentials.password,
        },
        logger: false,
      });

      try {
        await client.connect();

        // Find the archive mailbox
        const mailboxes = await client.list();
        const archiveBox = mailboxes.find(
          (mb) =>
            mb.specialUse === "\\Archive" ||
            mb.path.toLowerCase() === "archive"
        );

        if (archiveBox) {
          const lock = await client.getMailboxLock("INBOX");
          try {
            // Move each message by UID
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
      } catch (err) {
        console.error("[archive] IMAP move error:", err);
        // Continue with DB update even if IMAP fails
      } finally {
        try {
          await client.logout();
        } catch {
          // Ignore logout errors
        }
      }
    }
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
