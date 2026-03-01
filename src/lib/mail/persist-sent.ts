import { db } from "@/lib/db";

/** Generate a unique negative UID for locally-created messages (must fit INT4: max 2,147,483,647). */
export function generateTempUid(): number {
  return -(Math.floor(Math.random() * 2_000_000_000) + 1);
}

/** Find the Sent folder for an email connection, falling back to any folder. */
export async function getSentFolder(emailConnectionId: string) {
  return (
    (await db.folder.findFirst({
      where: { emailConnectionId, specialUse: "sent" },
    })) ||
    (await db.folder.findFirst({
      where: { emailConnectionId },
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
  emailConnectionId: string;
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
  const folder = await getSentFolder(opts.emailConnectionId);
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
      emailConnectionId: opts.emailConnectionId,
    },
  });
}
