import { db } from "@/lib/db";

/** Generate a unique negative UID for locally-created messages. Uses milliseconds + random to avoid collisions on rapid sends. */
export function generateTempUid(): number {
  return -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
}

/** Find the user's Sent folder, falling back to any folder. */
export async function getSentFolder(userId: string) {
  return (
    (await db.folder.findFirst({
      where: { userId, specialUse: "sent" },
    })) ||
    (await db.folder.findFirst({
      where: { userId },
    }))
  );
}

/** Create a snippet from message text. */
export function createSnippet(text: string): string {
  return text.length > 150 ? text.substring(0, 150) + "..." : text;
}

/**
 * Persist a sent message to the database with a negative UID placeholder.
 * Will be reconciled with the real IMAP UID on next sync.
 */
export async function createLocalSentMessage(opts: {
  userId: string;
  messageId: string | null;
  threadId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  text: string;
  html?: string | null;
}) {
  const folder = await getSentFolder(opts.userId);
  if (!folder) return null;

  return db.message.create({
    data: {
      uid: generateTempUid(),
      messageId: opts.messageId,
      threadId: opts.threadId,
      inReplyTo: opts.inReplyTo,
      references: opts.references,
      subject: opts.subject,
      fromAddress: opts.fromAddress,
      fromName: null,
      toAddresses: opts.toAddresses,
      ccAddresses: [],
      sentAt: new Date(),
      receivedAt: new Date(),
      textBody: opts.text,
      htmlBody: opts.html ?? null,
      snippet: createSnippet(opts.text),
      isRead: true,
      isInScreener: false,
      isInImbox: false,
      isInFeed: false,
      isInPaperTrail: false,
      folderId: folder.id,
      userId: opts.userId,
    },
  });
}
