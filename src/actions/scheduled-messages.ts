"use server";

import { revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { z } from "zod";
import { sendScheduledEmail } from "@/lib/mail/scheduled-send";
import { createLocalSentMessage } from "@/lib/mail/persist-sent";

const createSchema = z.object({
  to: z.string().email(),
  subject: z.string(),
  textBody: z.string(),
  htmlBody: z.string().optional(),
  scheduledFor: z.string().transform((s) => {
    const date = new Date(s);
    if (isNaN(date.getTime())) throw new Error("Invalid date");
    if (date <= new Date()) throw new Error("scheduledFor must be in the future");
    return date;
  }),
  emailConnectionId: z.string(),
  inReplyToMessageId: z.string().optional(),
  references: z.string().optional(),
});

const editSchema = z.object({
  to: z.string().email().optional(),
  subject: z.string().optional(),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  scheduledFor: z
    .string()
    .transform((s) => {
      const date = new Date(s);
      if (isNaN(date.getTime())) throw new Error("Invalid date");
      if (date <= new Date()) throw new Error("scheduledFor must be in the future");
      return date;
    })
    .optional(),
  emailConnectionId: z.string().optional(),
  inReplyToMessageId: z.string().optional(),
  references: z.string().optional(),
});

export async function createScheduledMessage(
  data: z.input<typeof createSchema>,
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;
  const parsed = createSchema.parse(data);

  // Verify connection belongs to user
  const connection = await db.emailConnection.findFirst({
    where: { id: parsed.emailConnectionId, userId },
  });
  if (!connection) throw new Error("Email connection not found");

  // Encrypt body fields at rest
  const encryptedTextBody = encrypt(parsed.textBody);
  const encryptedHtmlBody = parsed.htmlBody
    ? encrypt(parsed.htmlBody)
    : null;

  // Add 1–14 minutes of jitter so scheduled sends don't land exactly on the hour
  const jitterMs = (1 + Math.random() * 13) * 60_000;
  const jitteredTime = new Date(parsed.scheduledFor.getTime() + jitterMs);

  const record = await db.scheduledMessage.create({
    data: {
      userId,
      emailConnectionId: parsed.emailConnectionId,
      to: parsed.to,
      subject: parsed.subject,
      textBody: encryptedTextBody,
      htmlBody: encryptedHtmlBody,
      scheduledFor: jitteredTime,
      inReplyToMessageId: parsed.inReplyToMessageId ?? null,
      references: parsed.references ?? null,
    },
  });

  revalidateTag("sidebar-counts");

  return { id: record.id };
}

export async function cancelScheduledMessage(id: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;

  const msg = await db.scheduledMessage.findFirst({
    where: { id, userId },
  });
  if (!msg) throw new Error("Scheduled message not found");
  if (msg.status !== "PENDING") throw new Error("Only PENDING messages can be cancelled");

  await db.scheduledMessage.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  revalidateTag("sidebar-counts");
}

export async function editScheduledMessage(
  id: string,
  data: z.input<typeof editSchema>,
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;
  const parsed = editSchema.parse(data);

  const msg = await db.scheduledMessage.findFirst({
    where: { id, userId },
  });
  if (!msg) throw new Error("Scheduled message not found");
  if (msg.status !== "PENDING") throw new Error("Only PENDING messages can be edited");

  // If connection changed, verify the new one belongs to user
  if (parsed.emailConnectionId && parsed.emailConnectionId !== msg.emailConnectionId) {
    const connection = await db.emailConnection.findFirst({
      where: { id: parsed.emailConnectionId, userId },
    });
    if (!connection) throw new Error("Email connection not found");
  }

  // Build update payload, encrypting body fields if provided
  const updateData: Record<string, unknown> = {};
  if (parsed.to !== undefined) updateData.to = parsed.to;
  if (parsed.subject !== undefined) updateData.subject = parsed.subject;
  if (parsed.textBody !== undefined) updateData.textBody = encrypt(parsed.textBody);
  if (parsed.htmlBody !== undefined) updateData.htmlBody = encrypt(parsed.htmlBody);
  if (parsed.scheduledFor !== undefined) {
    const jitterMs = (1 + Math.random() * 13) * 60_000;
    updateData.scheduledFor = new Date(parsed.scheduledFor.getTime() + jitterMs);
  }
  if (parsed.emailConnectionId !== undefined)
    updateData.emailConnectionId = parsed.emailConnectionId;
  if (parsed.inReplyToMessageId !== undefined)
    updateData.inReplyToMessageId = parsed.inReplyToMessageId;
  if (parsed.references !== undefined) updateData.references = parsed.references;

  await db.scheduledMessage.update({
    where: { id },
    data: updateData,
  });

  revalidateTag("sidebar-counts");
}

export async function sendScheduledMessageNow(id: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;

  // Atomic CAS: claim this message for sending
  const claimed = await db.scheduledMessage.updateMany({
    where: { id, userId, status: "PENDING" },
    data: { status: "SENDING", sendingStartedAt: new Date() },
  });

  if (claimed.count === 0) {
    throw new Error("Message is no longer PENDING");
  }

  // Fetch the full message with connection
  const msg = await db.scheduledMessage.findUnique({
    where: { id },
    include: { emailConnection: true },
  });

  if (!msg) throw new Error("Scheduled message not found");

  try {
    // Idempotency: if already sent (has smtpMessageId), skip SMTP
    if (msg.smtpMessageId) {
      await db.scheduledMessage.update({
        where: { id },
        data: { status: "SENT" },
      });
      revalidateTag("sidebar-counts");
      return;
    }

    const result = await sendScheduledEmail(msg, msg.emailConnection);

    // Record SMTP message ID and mark as SENT
    await db.scheduledMessage.update({
      where: { id },
      data: { status: "SENT", smtpMessageId: result.messageId || null },
    });

    // Decrypt body for local persistence
    const textBody = decrypt(msg.textBody);
    const htmlBody = msg.htmlBody ? decrypt(msg.htmlBody) : null;

    // Resolve thread context
    let threadId: string | null = null;
    const refList = msg.references ? msg.references.split(" ").filter(Boolean) : [];
    if (msg.inReplyToMessageId || refList.length > 0) {
      const relatedIds = [...refList];
      if (msg.inReplyToMessageId && !relatedIds.includes(msg.inReplyToMessageId)) {
        relatedIds.push(msg.inReplyToMessageId);
      }
      const existingThread = await db.message.findFirst({
        where: {
          userId,
          OR: [
            { messageId: { in: relatedIds } },
            { threadId: { in: relatedIds } },
          ],
          threadId: { not: null },
        },
        select: { threadId: true },
      });
      threadId = existingThread?.threadId || relatedIds[0] || null;
    }

    const fromAddress = msg.emailConnection.sendAsEmail || msg.emailConnection.email;

    await createLocalSentMessage({
      userId,
      emailConnectionId: msg.emailConnectionId,
      messageId: result.messageId || null,
      threadId,
      inReplyTo: msg.inReplyToMessageId || null,
      references: refList,
      subject: msg.subject,
      fromAddress,
      toAddresses: [msg.to],
      text: textBody,
      html: htmlBody,
    });

    revalidateTag("sidebar-counts");
  } catch (err) {
    // Roll back to PENDING so user can retry
    await db.scheduledMessage.update({
      where: { id },
      data: {
        status: "PENDING",
        sendingStartedAt: null,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}
