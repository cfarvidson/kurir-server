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

  await transporter.sendMail({
    from: credentials.email,
    to: replyTo,
    subject,
    text: body,
    ...(message.messageId && { inReplyTo: message.messageId }),
    ...(references.length > 0 && {
      references: references.join(" "),
    }),
  });

  // Mark the original as answered
  await db.message.update({
    where: { id: messageId },
    data: { isAnswered: true },
  });

  revalidatePath(`/imbox/${messageId}`);
  revalidatePath("/imbox");
  revalidatePath("/sent");
}
