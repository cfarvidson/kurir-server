import { db } from "@/lib/db";
import { withImapConnection } from "./imap-client";
import MailComposer from "nodemailer/lib/mail-composer";

/** Generate a unique negative UID for locally-created messages (must fit INT4: max 2,147,483,647). */
let tempUidCounter = Math.floor(Date.now() / 1000) % 1_000_000_000;
export function generateTempUid(): number {
  tempUidCounter += 1;
  if (tempUidCounter > 2_000_000_000) tempUidCounter = 1;
  return -tempUidCounter;
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

/**
 * Append a sent message to the IMAP Sent folder.
 * Builds an RFC822 message from the provided fields and uses IMAP APPEND.
 * Should be called fire-and-forget (.catch(console.error)).
 */
export async function appendToImapSent(opts: {
  emailConnectionId: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  text: string;
  html?: string | null;
}): Promise<void> {
  const folder = await db.folder.findFirst({
    where: { emailConnectionId: opts.emailConnectionId, specialUse: "sent" },
    select: { path: true },
  });
  if (!folder) return;

  const mail = new MailComposer({
    from: opts.fromAddress,
    to: opts.toAddresses.join(", "),
    subject: opts.subject,
    text: opts.text,
    ...(opts.html && { html: opts.html }),
    ...(opts.messageId && { messageId: opts.messageId }),
    ...(opts.inReplyTo && { inReplyTo: opts.inReplyTo }),
    ...(opts.references.length > 0 && {
      references: opts.references.join(" "),
    }),
  });

  const raw = await mail.compile().build();

  await withImapConnection(opts.emailConnectionId, async (client) => {
    await client.append(folder.path, raw, ["\\Seen"]);
  });
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
