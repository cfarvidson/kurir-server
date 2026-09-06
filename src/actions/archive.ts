"use server";

import { revalidatePath, updateTag } from "next/cache";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { moveToArchiveViaImap } from "@/lib/mail/archive-imap";
import {
  ARCHIVE_CLEAR_DATA,
  autoRejectFullyArchivedSenders,
  archiveThread,
  unarchiveThread,
  unarchiveThreadsForUser,
} from "@/lib/mail/mutations";

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

export async function archiveConversation(
  messageId: string,
  sourcePath?: string,
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await archiveThread(session.user.id, messageId);

  updateTag("sidebar-counts");
  revalidatePath("/archive");
  revalidatePath("/reply-later");
  revalidatePath("/follow-up");
  if (sourcePath) {
    const basePath = sourcePath.split("?")[0];
    revalidatePath(basePath);
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
    data: ARCHIVE_CLEAR_DATA,
  });

  await autoRejectFullyArchivedSenders(allMessageIds);

  updateTag("sidebar-counts");
  revalidatePath("/archive");
  revalidatePath("/reply-later");
  revalidatePath("/follow-up");
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

  const { category } = await unarchiveThread(session.user.id, messageId);

  updateTag("sidebar-counts");
  revalidatePath(categoryToPath(category));
}

export async function unarchiveConversations(messageIds: string[]) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await unarchiveThreadsForUser(session.user.id, messageIds);

  updateTag("sidebar-counts");
  revalidatePath("/archive");
  revalidatePath("/imbox");
  revalidatePath("/feed");
  revalidatePath("/paper-trail");
}
