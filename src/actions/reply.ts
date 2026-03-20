"use server";

import { auth, getConnectionCredentials } from "@/lib/auth";
import { db } from "@/lib/db";
import { createLocalSentMessage, appendToImapSent } from "@/lib/mail/persist-sent";
import { revalidatePath, revalidateTag } from "next/cache";
import nodemailer from "nodemailer";

export async function replyToMessage(messageId: string, body: string, to?: string) {
  if (body.length > 1_000_000) {
    throw new Error("Message body too large");
  }

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
      emailConnectionId: true,
    },
  });

  if (!message) {
    throw new Error("Message not found");
  }

  // Use the connection that received the message to reply from
  const credentials = await getConnectionCredentials(
    message.emailConnectionId,
    session.user.id,
  );
  if (!credentials) {
    throw new Error("Email credentials not found");
  }

  const replyTo = to || message.replyTo || message.fromAddress;
  const subject = message.subject?.startsWith("Re:")
    ? message.subject
    : `Re: ${message.subject || ""}`;

  const references = [...(message.references || [])];
  if (message.messageId && !references.includes(message.messageId)) {
    references.push(message.messageId);
  }

  const fromAddress = credentials.sendAsEmail || credentials.email;

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
    from: fromAddress,
    to: replyTo,
    subject,
    text: body,
    ...(message.messageId && { inReplyTo: message.messageId }),
    ...(references.length > 0 && {
      references: references.join(" "),
    }),
  });

  await createLocalSentMessage({
    userId: session.user.id,
    emailConnectionId: message.emailConnectionId,
    messageId: info.messageId || null,
    threadId: message.threadId || message.messageId || null,
    inReplyTo: message.messageId || null,
    references,
    subject,
    fromAddress,
    toAddresses: [replyTo],
    text: body,
  });

  // Append to IMAP Sent folder (fire-and-forget)
  appendToImapSent({
    emailConnectionId: message.emailConnectionId,
    messageId: info.messageId || null,
    inReplyTo: message.messageId || null,
    references,
    subject,
    fromAddress,
    toAddresses: [replyTo],
    text: body,
  }).catch(console.error);

  await db.message.update({
    where: { id: messageId },
    data: { isAnswered: true },
  });

  revalidateTag("sidebar-counts");
  revalidatePath("/", "layout");
}
