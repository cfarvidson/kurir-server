"use server";

import { auth, getUserCredentials } from "@/lib/auth";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import nodemailer from "nodemailer";

export async function replyToMessage(messageId: string, body: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const message = await db.message.findFirst({
    where: { id: messageId, userId: session.user.id },
    select: {
      messageId: true,
      threadId: true,
      references: true,
      subject: true,
      fromAddress: true,
      replyTo: true,
    },
  });

  if (!message) {
    throw new Error("Message not found");
  }

  const credentials = await getUserCredentials(session.user.id);
  if (!credentials) {
    throw new Error("Email credentials not found");
  }

  const replyTo = message.replyTo || message.fromAddress;
  const subject = message.subject?.startsWith("Re:")
    ? message.subject
    : `Re: ${message.subject || ""}`;

  // Build references chain
  const references = [...(message.references || [])];
  if (message.messageId && !references.includes(message.messageId)) {
    references.push(message.messageId);
  }

  const transporter = nodemailer.createTransport({
    host: credentials.smtp.host,
    port: credentials.smtp.port,
    secure: credentials.smtp.port === 465,
    auth: {
      user: credentials.email,
      pass: credentials.password,
    },
  });

  const info = await transporter.sendMail({
    from: credentials.email,
    to: replyTo,
    subject,
    text: body,
    ...(message.messageId && { inReplyTo: message.messageId }),
    ...(references.length > 0 && {
      references: references.join(" "),
    }),
  });

  // Save the sent reply to DB so it appears everywhere immediately
  const sentMessageId = info.messageId || null;
  const threadId = message.threadId || message.messageId || null;

  // Find the Sent folder, fall back to any folder
  const folder =
    (await db.folder.findFirst({
      where: { userId: session.user.id, specialUse: "sent" },
    })) ||
    (await db.folder.findFirst({
      where: { userId: session.user.id },
    }));

  if (folder) {
    // Negative UID = locally-created, will be replaced by real IMAP UID on next sync
    const tempUid = -Math.abs(Math.floor(Date.now() / 1000));

    const snippet =
      body.length > 150 ? body.substring(0, 150) + "..." : body;

    await db.message.create({
      data: {
        uid: tempUid,
        messageId: sentMessageId,
        threadId,
        inReplyTo: message.messageId || null,
        references,
        subject,
        fromAddress: credentials.email,
        fromName: null,
        toAddresses: [replyTo],
        ccAddresses: [],
        sentAt: new Date(),
        receivedAt: new Date(),
        textBody: body,
        htmlBody: null,
        snippet,
        isRead: true,
        isInScreener: false,
        isInImbox: false,
        isInFeed: false,
        isInPaperTrail: false,
        folderId: folder.id,
        userId: session.user.id,
      },
    });
  }

  // Mark the original as answered
  await db.message.update({
    where: { id: messageId },
    data: { isAnswered: true },
  });

  // Refresh all server-rendered pages
  revalidatePath("/", "layout");
}
