"use server";

import { auth, getUserCredentials } from "@/lib/auth";
import { db } from "@/lib/db";
import { createLocalSentMessage } from "@/lib/mail/persist-sent";
import { revalidatePath, revalidateTag } from "next/cache";
import nodemailer from "nodemailer";

export async function replyToMessage(messageId: string, body: string, to?: string) {
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

  const replyTo = to || message.replyTo || message.fromAddress;
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
  await createLocalSentMessage({
    userId: session.user.id,
    messageId: info.messageId || null,
    threadId: message.threadId || message.messageId || null,
    inReplyTo: message.messageId || null,
    references,
    subject,
    fromAddress: credentials.email,
    toAddresses: [replyTo],
    text: body,
  });

  // Mark the original as answered
  await db.message.update({
    where: { id: messageId },
    data: { isAnswered: true },
  });

  // Refresh all server-rendered pages
  revalidateTag("sidebar-counts");
  revalidatePath("/", "layout");
}
