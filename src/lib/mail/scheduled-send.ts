import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createLocalSentMessage, appendToImapSent } from "./persist-sent";
import { convertMarkdownToEmailHtml } from "./markdown-to-email";
import { loadAttachmentsForSend } from "./attachment-helpers";
import { emitToUser } from "./sse-subscribers";
import nodemailer from "nodemailer";
import type { EmailConnection, ScheduledMessage } from "@prisma/client";

const STALE_SENDING_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;

/** Backoff schedule in milliseconds: 1m, 5m, 15m, 1h, 4h */
const BACKOFF_STEPS_MS = [
  1 * 60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  4 * 60 * 60_000,
];

/**
 * Main entry point: claim and send all due scheduled messages.
 * Called from background-sync loop.
 */
export async function sendDueScheduledMessages(): Promise<void> {
  const now = new Date();

  // Atomic claim: grab all due messages in one shot.
  // Covers: (1) PENDING + past due, (2) PENDING + retry due, (3) SENDING + stale (stuck > 5min)
  const claimed = await db.scheduledMessage.updateMany({
    where: {
      OR: [
        // Due to send
        {
          status: "PENDING",
          scheduledFor: { lte: now },
          nextRetryAt: null,
        },
        // Retry is due
        {
          status: "PENDING",
          nextRetryAt: { lte: now },
        },
        // Stale sending lock (stuck > 5 minutes)
        {
          status: "SENDING",
          sendingStartedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) },
        },
      ],
    },
    data: {
      status: "SENDING",
      sendingStartedAt: now,
    },
  });

  if (claimed.count === 0) return;

  // Fetch the messages we just claimed (status = SENDING, sendingStartedAt = now)
  const messages = await db.scheduledMessage.findMany({
    where: {
      status: "SENDING",
      sendingStartedAt: now,
    },
    include: { emailConnection: true },
  });

  for (const msg of messages) {
    try {
      await processSingleMessage(msg);
    } catch (err) {
      console.error(
        `[scheduled-send] Unhandled error processing message ${msg.id}:`,
        err,
      );
    }
  }
}

async function processSingleMessage(
  msg: ScheduledMessage & { emailConnection: EmailConnection },
): Promise<void> {
  // Verify connection still belongs to the user
  if (msg.emailConnection.userId !== msg.userId) {
    await db.scheduledMessage.update({
      where: { id: msg.id },
      data: { status: "FAILED", error: "Email connection ownership mismatch" },
    });
    return;
  }

  // Idempotency: if we already sent this (have an smtpMessageId), skip SMTP
  if (msg.smtpMessageId) {
    await db.scheduledMessage.update({
      where: { id: msg.id },
      data: { status: "SENT" },
    });
    return;
  }

  try {
    const result = await sendScheduledEmail(msg, msg.emailConnection);

    // Mark as SENT with the SMTP message ID
    await db.scheduledMessage.update({
      where: { id: msg.id },
      data: {
        status: "SENT",
        smtpMessageId: result.messageId || null,
        attempts: msg.attempts + 1,
      },
    });

    // Persist a local copy of the sent message
    const textBody = decrypt(msg.textBody);
    const htmlBody = msg.htmlBody ? decrypt(msg.htmlBody) : null;
    const refList = msg.references
      ? msg.references.split(" ").filter(Boolean)
      : [];

    let threadId: string | null = null;
    if (msg.inReplyToMessageId || refList.length > 0) {
      const relatedIds = [...refList];
      if (
        msg.inReplyToMessageId &&
        !relatedIds.includes(msg.inReplyToMessageId)
      ) {
        relatedIds.push(msg.inReplyToMessageId);
      }
      const existingThread = await db.message.findFirst({
        where: {
          userId: msg.userId,
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

    const fromAddress =
      msg.emailConnection.sendAsEmail || msg.emailConnection.email;

    // Load attachments for persist (reuse for IMAP sent append)
    const sentLoaded = await loadAttachmentsForSend(
      msg.attachmentIds || [],
      msg.userId,
    );

    await createLocalSentMessage({
      userId: msg.userId,
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
      attachmentIds: sentLoaded.ids,
    });

    // Append to IMAP Sent folder (fire-and-forget)
    appendToImapSent({
      emailConnectionId: msg.emailConnectionId,
      messageId: result.messageId || null,
      inReplyTo: msg.inReplyToMessageId || null,
      references: refList,
      subject: msg.subject,
      fromAddress,
      toAddresses: [msg.to],
      text: textBody,
      html: htmlBody,
      attachments: sentLoaded.sentAttachments,
    }).catch(console.error);

    // Notify connected clients
    emitToUser(msg.userId, {
      type: "scheduled-sent",
      data: { scheduledMessageId: msg.id },
    });
  } catch (err) {
    const attempts = msg.attempts + 1;
    const permanent = isSmtpPermanentError(err);
    const sanitizedError = sanitizeError(err);

    if (permanent || attempts >= MAX_ATTEMPTS) {
      await db.scheduledMessage.update({
        where: { id: msg.id },
        data: {
          status: "FAILED",
          attempts,
          error: sanitizedError,
          sendingStartedAt: null,
        },
      });

      emitToUser(msg.userId, {
        type: "scheduled-failed",
        data: { scheduledMessageId: msg.id, error: sanitizedError },
      });
    } else {
      // Transient failure: schedule retry with exponential backoff
      const delay = getNextRetryDelay(attempts);
      await db.scheduledMessage.update({
        where: { id: msg.id },
        data: {
          status: "PENDING",
          attempts,
          nextRetryAt: new Date(Date.now() + delay),
          error: sanitizedError,
          sendingStartedAt: null,
        },
      });
    }
  }
}

/**
 * Send a single scheduled email via nodemailer.
 * Decrypts the connection password and message body fields.
 */
export async function sendScheduledEmail(
  msg: ScheduledMessage,
  connection: EmailConnection,
): Promise<{ messageId: string | false }> {
  const password = decrypt(connection.encryptedPassword);
  const textBody = decrypt(msg.textBody);
  const htmlBody = msg.htmlBody ? decrypt(msg.htmlBody) : undefined;
  const fromAddress = connection.sendAsEmail || connection.email;

  // Convert markdown to email HTML if no explicit html
  let emailHtml = htmlBody;
  let inlineImageIds: string[] = [];
  if (!htmlBody && textBody) {
    const converted = convertMarkdownToEmailHtml(textBody);
    emailHtml = converted.html;
    inlineImageIds = converted.inlineImageIds;
  }

  // Load attachments if any
  const loaded = await loadAttachmentsForSend(
    msg.attachmentIds || [],
    msg.userId,
    inlineImageIds,
  );

  const transporter = nodemailer.createTransport({
    host: connection.smtpHost,
    port: connection.smtpPort,
    secure: connection.smtpPort === 465,
    auth: {
      user: connection.email,
      pass: password,
    },
  });

  const refList = msg.references
    ? msg.references.split(" ").filter(Boolean)
    : [];

  const result = await transporter.sendMail({
    from: fromAddress,
    to: msg.to,
    subject: msg.subject,
    text: textBody,
    html: emailHtml,
    ...(msg.inReplyToMessageId && { inReplyTo: msg.inReplyToMessageId }),
    ...(refList.length > 0 && { references: refList.join(" ") }),
    ...(loaded.nodemailerAttachments.length > 0 && {
      attachments: loaded.nodemailerAttachments,
    }),
  });

  return { messageId: result.messageId };
}

/**
 * Classify an SMTP error as permanent (5xx) or transient (4xx / network).
 * Permanent errors should not be retried.
 */
export function isSmtpPermanentError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const code = (error as Record<string, unknown>).responseCode;
    if (typeof code === "number") {
      return code >= 500 && code < 600;
    }
  }
  return false;
}

/**
 * Exponential backoff: [1m, 5m, 15m, 1h, 4h] + 20% jitter.
 * @param attempts - Number of attempts already made (1-based).
 */
export function getNextRetryDelay(attempts: number): number {
  const idx = Math.min(attempts - 1, BACKOFF_STEPS_MS.length - 1);
  const base = BACKOFF_STEPS_MS[idx];
  // Add up to 20% jitter
  const jitter = base * 0.2 * Math.random();
  return base + jitter;
}

/**
 * Strip IP addresses and hostnames from error strings to avoid
 * leaking infrastructure details into the database.
 */
export function sanitizeError(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : String(error);
  return raw
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[IP]") // IPv4
    .replace(
      /\b[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}\b/g,
      "[HOST]",
    ) // hostnames
    .slice(0, 500); // Truncate to a reasonable length
}
