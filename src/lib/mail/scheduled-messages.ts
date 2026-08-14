import { z } from "zod";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { getConnectionCredentialsInternal } from "@/lib/auth";
import { sendScheduledEmail } from "@/lib/mail/scheduled-send";
import {
  createLocalSentMessage,
  appendToImapSent,
} from "@/lib/mail/persist-sent";
import { parseRecipients } from "@/lib/mail/recipients";
import { rateLimitSend } from "@/lib/rate-limit";
import { loadAttachmentsForSend } from "@/lib/mail/attachment-helpers";
import { isDemoInstance } from "@/lib/demo";

/**
 * Scheduled-message cores, shared by the web server actions
 * (`@/actions/scheduled-messages`) and the mobile routes
 * (`/api/mobile/scheduled`). Auth is resolved by the callers; these functions
 * take a `userId` and own everything else — the shared zod schema, the 1–14
 * minute jitter, body encryption, ownership checks and the send-now flow — so
 * both surfaces create identical rows and can never drift.
 *
 * Like the cores in `mutations.ts`, these do NOT touch the cache layer —
 * `updateTag` throws outside a Server Action (it took every mobile route here
 * down after the row had already been written), so the web wrappers own
 * updateTag/revalidatePath.
 *
 * NB: the background worker (`sendDueScheduledMessages` in `scheduled-send.ts`)
 * is untouched; it just receives rows from a second source through this exact
 * create-core.
 */

// One optional recipient field (To/Cc/Bcc alike): accepts comma/semicolon-
// separated addresses, stored as a normalized comma-joined string. Omitted
// means "leave as is" (edit) / "none" (create); an empty string maps to null
// so it clears the field on edit. Any provided address must be valid — the
// whole value is rejected otherwise.
export const optionalRecipientField = z
  .string()
  .transform((val) => {
    const { recipients, invalid } = parseRecipients(val);
    if (invalid.length > 0) {
      throw new Error(`Invalid recipient address: ${invalid.join(", ")}`);
    }
    return recipients.length > 0 ? recipients.join(", ") : null;
  })
  .optional();

/**
 * Shared create schema for both the web action and the mobile POST route, so
 * a single definition validates every scheduled message. `scheduledFor` must
 * parse to a future instant (the jitter is added on top, server-side).
 */
export const createScheduledSchema = z.object({
  // To is optional like Cc/Bcc — a schedule must reach at least one recipient
  // across the three fields (checked in the create/edit cores), mirroring the
  // direct-send route's support for Cc- or Bcc-only mail.
  to: optionalRecipientField,
  cc: optionalRecipientField,
  bcc: optionalRecipientField,
  subject: z.string(),
  textBody: z.string(),
  htmlBody: z.string().optional(),
  scheduledFor: z.string().transform((s) => {
    const date = new Date(s);
    if (isNaN(date.getTime())) throw new Error("Invalid date");
    if (date <= new Date())
      throw new Error("scheduledFor must be in the future");
    return date;
  }),
  emailConnectionId: z.string(),
  inReplyToMessageId: z.string().optional(),
  references: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
});

export type CreateScheduledInput = z.input<typeof createScheduledSchema>;

const futureDate = z.string().transform((s) => {
  const date = new Date(s);
  if (isNaN(date.getTime())) throw new Error("Invalid date");
  if (date <= new Date()) throw new Error("scheduledFor must be in the future");
  return date;
});

/** Shared edit schema for the web action and MCP `update_scheduled`. */
export const updateScheduledSchema = z.object({
  to: optionalRecipientField,
  cc: optionalRecipientField,
  bcc: optionalRecipientField,
  subject: z.string().optional(),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  scheduledFor: futureDate.optional(),
  emailConnectionId: z.string().optional(),
  inReplyToMessageId: z.string().optional(),
  references: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
});

export type UpdateScheduledInput = z.input<typeof updateScheduledSchema>;

/**
 * Create a PENDING scheduled message for `userId`. Verifies the connection and
 * any referenced attachments belong to the user, encrypts the body at rest,
 * and adds 1–14 minutes of jitter so scheduled sends don't land exactly on the
 * hour. Returns the jittered `scheduledFor` so the client shows the real send
 * time (the server's answer), not its own guess.
 */
async function assertSendRateLimit(userId: string): Promise<void> {
  const rl = await rateLimitSend(userId);
  if (!rl.allowed) {
    throw new Error(
      `Too many messages sent — try again in ${rl.retryAfter} seconds`,
    );
  }
}

export async function createScheduledMessageForUser(
  userId: string,
  input: CreateScheduledInput,
) {
  if (isDemoInstance()) {
    throw new Error("Sending is disabled on this demo instance.");
  }
  await assertSendRateLimit(userId);
  return insertScheduledMessageForUser(userId, input);
}

/**
 * Write a scheduled row. Caller must have already applied demo and send
 * rate-limit gates (HTTP/mobile wrappers do; MCP rate-limits before consume).
 */
export async function insertScheduledMessageForUser(
  userId: string,
  input: CreateScheduledInput,
) {
  const parsed = createScheduledSchema.parse(input);

  // At least one recipient across To/Cc/Bcc (direct-send parity).
  if (!parsed.to && !parsed.cc && !parsed.bcc) {
    throw new Error("No valid recipient address provided");
  }

  // Verify connection belongs to user
  const connection = await db.emailConnection.findFirst({
    where: { id: parsed.emailConnectionId, userId },
  });
  if (!connection) throw new Error("Email connection not found");

  // Verify any referenced attachments belong to user
  if (parsed.attachmentIds?.length) {
    const owned = await db.attachment.count({
      where: {
        id: { in: parsed.attachmentIds },
        OR: [{ userId }, { message: { userId } }],
      },
    });
    if (owned !== parsed.attachmentIds.length) {
      throw new Error("Invalid attachment references");
    }
  }

  // Encrypt body fields at rest
  const encryptedTextBody = encrypt(parsed.textBody);
  const encryptedHtmlBody = parsed.htmlBody ? encrypt(parsed.htmlBody) : null;

  // Add 1–14 minutes of jitter so scheduled sends don't land exactly on the hour
  const jitterMs = (1 + Math.random() * 13) * 60_000;
  const jitteredTime = new Date(parsed.scheduledFor.getTime() + jitterMs);

  const record = await db.scheduledMessage.create({
    data: {
      userId,
      emailConnectionId: parsed.emailConnectionId,
      // `to` is a non-nullable column; a Cc/Bcc-only schedule stores "".
      to: parsed.to ?? "",
      cc: parsed.cc ?? null,
      bcc: parsed.bcc ?? null,
      subject: parsed.subject,
      textBody: encryptedTextBody,
      htmlBody: encryptedHtmlBody,
      scheduledFor: jitteredTime,
      inReplyToMessageId: parsed.inReplyToMessageId ?? null,
      references: parsed.references ?? null,
      attachmentIds: parsed.attachmentIds ?? [],
    },
  });

  return { id: record.id, scheduledFor: jitteredTime };
}

/**
 * List the user's still-relevant scheduled messages (queued, in-flight, or
 * failed), soonest first. The body stays encrypted — only metadata plus the
 * `to`/`subject` line is returned.
 */
export async function listScheduledForUser(userId: string) {
  return db.scheduledMessage.findMany({
    where: { userId, status: { in: ["PENDING", "SENDING", "FAILED"] } },
    orderBy: { scheduledFor: "asc" },
    select: {
      id: true,
      to: true,
      cc: true,
      subject: true,
      scheduledFor: true,
      status: true,
      error: true,
    },
  });
}

/**
 * Edit a PENDING scheduled message. Ownership-checked. Only provided fields
 * change; an explicit empty recipient string clears that field.
 */
export async function updateScheduledForUser(
  userId: string,
  id: string,
  data: UpdateScheduledInput,
) {
  const parsed = updateScheduledSchema.parse(data);

  const msg = await db.scheduledMessage.findFirst({
    where: { id, userId },
  });
  if (!msg) throw new Error("Scheduled message not found");
  if (msg.status !== "PENDING") {
    throw new Error("Only PENDING messages can be edited");
  }

  if (
    parsed.emailConnectionId &&
    parsed.emailConnectionId !== msg.emailConnectionId
  ) {
    const connection = await db.emailConnection.findFirst({
      where: { id: parsed.emailConnectionId, userId },
    });
    if (!connection) throw new Error("Email connection not found");
  }

  const effectiveTo = parsed.to !== undefined ? parsed.to : msg.to;
  const effectiveCc = parsed.cc !== undefined ? parsed.cc : msg.cc;
  const effectiveBcc = parsed.bcc !== undefined ? parsed.bcc : msg.bcc;
  if (!effectiveTo && !effectiveCc && !effectiveBcc) {
    throw new Error("No valid recipient address provided");
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.to !== undefined) updateData.to = parsed.to ?? "";
  if (parsed.cc !== undefined) updateData.cc = parsed.cc;
  if (parsed.bcc !== undefined) updateData.bcc = parsed.bcc;
  if (parsed.subject !== undefined) updateData.subject = parsed.subject;
  if (parsed.textBody !== undefined)
    updateData.textBody = encrypt(parsed.textBody);
  if (parsed.htmlBody !== undefined)
    updateData.htmlBody = encrypt(parsed.htmlBody);
  if (parsed.scheduledFor !== undefined) {
    const jitterMs = (1 + Math.random() * 13) * 60_000;
    updateData.scheduledFor = new Date(
      parsed.scheduledFor.getTime() + jitterMs,
    );
  }
  if (parsed.emailConnectionId !== undefined)
    updateData.emailConnectionId = parsed.emailConnectionId;
  if (parsed.inReplyToMessageId !== undefined)
    updateData.inReplyToMessageId = parsed.inReplyToMessageId;
  if (parsed.references !== undefined)
    updateData.references = parsed.references;
  if (parsed.attachmentIds !== undefined)
    updateData.attachmentIds = parsed.attachmentIds;

  await db.scheduledMessage.update({
    where: { id },
    data: updateData,
  });

  return {
    id,
    scheduledFor: (updateData.scheduledFor as Date) ?? msg.scheduledFor,
  };
}

export type CancelScheduledResult = "cancelled" | "not_found" | "not_pending";

/**
 * Cancel a scheduled message. Ownership-checks first (so the caller can tell a
 * missing/not-owned row apart from a non-PENDING one), then flips
 * PENDING → CANCELLED with a compare-and-set so the background scheduler can
 * never also deliver it.
 */
export async function cancelScheduledForUser(
  userId: string,
  id: string,
): Promise<CancelScheduledResult> {
  const msg = await db.scheduledMessage.findFirst({
    where: { id, userId },
    select: { status: true },
  });
  if (!msg) return "not_found";
  if (msg.status !== "PENDING") return "not_pending";

  const result = await db.scheduledMessage.updateMany({
    where: { id, userId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  // Lost the race to the scheduler between the read and the write.
  if (result.count === 0) return "not_pending";

  return "cancelled";
}

/**
 * Send a scheduled message immediately. Atomically claims PENDING → SENDING so
 * the background scheduler can never double-send, then delivers inline and
 * persists the sent copy — identical to the web "send now" path. Rolls the row
 * back to PENDING (recording the error) on any failure.
 */
/**
 * Push `scheduledFor` into the future so the worker cannot deliver during an
 * undo-send window, while leaving the row PENDING (a crash then still sends).
 */
export async function deferScheduledForUser(
  userId: string,
  id: string,
  deferMs: number,
): Promise<
  | { deferred: false; previousScheduledFor: null }
  | { deferred: true; previousScheduledFor: string }
> {
  const msg = await db.scheduledMessage.findFirst({
    where: { id, userId, status: "PENDING" },
    select: { scheduledFor: true },
  });
  if (!msg) return { deferred: false, previousScheduledFor: null };

  const floor = new Date(Date.now() + deferMs);
  const next =
    msg.scheduledFor.getTime() > floor.getTime() ? msg.scheduledFor : floor;

  const result = await db.scheduledMessage.updateMany({
    where: { id, userId, status: "PENDING" },
    data: { scheduledFor: next },
  });
  if (result.count === 0) {
    return { deferred: false, previousScheduledFor: null };
  }
  return {
    deferred: true,
    previousScheduledFor: msg.scheduledFor.toISOString(),
  };
}

export async function restoreScheduledTimeForUser(
  userId: string,
  id: string,
  scheduledFor: Date,
): Promise<boolean> {
  const result = await db.scheduledMessage.updateMany({
    where: { id, userId, status: "PENDING" },
    data: { scheduledFor },
  });
  return result.count === 1;
}

export async function sendScheduledNowForUser(userId: string, id: string) {
  if (isDemoInstance()) {
    throw new Error("Sending is disabled on this demo instance.");
  }
  return deliverScheduledNowForUser(userId, id, () =>
    assertSendRateLimit(userId),
  );
}

/**
 * Claim and deliver a scheduled row. Caller must have already applied the
 * demo gate. Pass `beforeSend` to enforce the send limiter after the CAS
 * claim (HTTP/mobile). MCP rate-limits before consume and omits it.
 */
export async function deliverScheduledNowForUser(
  userId: string,
  id: string,
  beforeSend?: () => Promise<void>,
) {
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
    await beforeSend?.();

    // Idempotency: if already sent (has smtpMessageId), skip SMTP
    if (msg.smtpMessageId) {
      await db.scheduledMessage.update({
        where: { id },
        data: { status: "SENT" },
      });
      return;
    }

    const credentials = await getConnectionCredentialsInternal(
      msg.emailConnectionId,
    );
    if (!credentials) throw new Error("Email credentials not found");

    const result = await sendScheduledEmail(
      msg,
      msg.emailConnection,
      credentials,
    );

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
    const refList = msg.references
      ? msg.references.split(" ").filter(Boolean)
      : [];
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

    const fromAddress =
      msg.emailConnection.sendAsEmail || msg.emailConnection.email;

    const sentLoaded = await loadAttachmentsForSend(
      msg.attachmentIds || [],
      userId,
    );

    await createLocalSentMessage({
      userId,
      emailConnectionId: msg.emailConnectionId,
      messageId: result.messageId || null,
      threadId,
      inReplyTo: msg.inReplyToMessageId || null,
      references: refList,
      subject: msg.subject,
      fromAddress,
      toAddresses: parseRecipients(msg.to).recipients,
      ccAddresses: parseRecipients(msg.cc ?? "").recipients,
      bccAddresses: parseRecipients(msg.bcc ?? "").recipients,
      text: textBody,
      html: htmlBody,
      attachmentIds: sentLoaded.ids,
    });

    appendToImapSent({
      emailConnectionId: msg.emailConnectionId,
      messageId: result.messageId || null,
      inReplyTo: msg.inReplyToMessageId || null,
      references: refList,
      subject: msg.subject,
      fromAddress,
      toAddresses: parseRecipients(msg.to).recipients,
      ccAddresses: parseRecipients(msg.cc ?? "").recipients,
      bccAddresses: parseRecipients(msg.bcc ?? "").recipients,
      text: textBody,
      html: htmlBody,
      attachments: sentLoaded.sentAttachments,
    }).catch(console.error);
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
