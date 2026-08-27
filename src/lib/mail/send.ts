import {
  getConnectionCredentials,
  getDefaultConnectionCredentials,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { DraftType } from "@prisma/client";
import { loadAttachmentsForSend } from "@/lib/mail/attachment-helpers";
import { buildSmtpAuth } from "@/lib/mail/auth-helpers";
import { findOrCreateContactForEmail } from "@/lib/mail/contacts";
import { deleteDraftForUser } from "@/lib/mail/drafts";
import { convertMarkdownToEmailHtml } from "@/lib/mail/markdown-to-email";
import {
  appendToImapSent,
  createLocalSentMessage,
} from "@/lib/mail/persist-sent";
import { parseRecipients } from "@/lib/mail/recipients";
import { assignThreadId } from "@/lib/mail/thread-assign";
import nodemailer from "nodemailer";
import { z } from "zod";

/**
 * Shared send core. HTTP POST /api/mail/send and the MCP send_mail tool
 * both call sendMailForUser so SMTP + persist semantics cannot drift.
 */

export const sendMailSchema = z.object({
  to: z.string(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().optional().default(""),
  text: z.string().optional().default(""),
  html: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
  fromConnectionId: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
  /**
   * The composer draft this send came from. Deleted server-side once SMTP
   * has accepted the mail, so cleanup no longer depends on the client
   * (web/iOS/MCP) remembering to call delete after a successful send.
   */
  draft: z
    .object({
      type: z.nativeEnum(DraftType),
      contextMessageId: z.string().min(1),
    })
    .optional(),
});

export type SendMailInput = z.infer<typeof sendMailSchema>;

export class SendMailError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SendMailError";
  }
}

export async function sendMailForUser(
  userId: string,
  input: SendMailInput,
): Promise<{ messageId?: string }> {
  const {
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    inReplyTo,
    references,
    fromConnectionId,
    attachmentIds,
    draft,
  } = input;

  // Support multiple recipients (comma/semicolon separated) across To/Cc/Bcc.
  // Reject the whole send if any address is malformed so partial sends never
  // happen silently.
  const { recipients, invalid } = parseRecipients(to);
  const { recipients: ccRecipients, invalid: ccInvalid } = parseRecipients(
    cc ?? "",
  );
  const { recipients: bccRecipients, invalid: bccInvalid } = parseRecipients(
    bcc ?? "",
  );
  const allInvalid = [...invalid, ...ccInvalid, ...bccInvalid];
  if (allInvalid.length > 0) {
    throw new SendMailError(
      `Invalid recipient address: ${allInvalid.join(", ")}`,
      400,
    );
  }
  // A send must reach at least one recipient across any field (allows
  // group-only or Bcc-only sends with an empty To).
  if (
    recipients.length === 0 &&
    ccRecipients.length === 0 &&
    bccRecipients.length === 0
  ) {
    throw new SendMailError("No valid recipient address provided", 400);
  }

  // Resolve credentials: use specified connection or fall back to default
  let credentials;
  let resolvedConnectionId: string;

  if (fromConnectionId) {
    // Verify the connection belongs to this user
    const conn = await db.emailConnection.findFirst({
      where: { id: fromConnectionId, userId },
      select: { id: true },
    });
    if (!conn) {
      throw new SendMailError("Email connection not found", 404);
    }
    credentials = await getConnectionCredentials(fromConnectionId, userId);
    resolvedConnectionId = fromConnectionId;
  } else {
    const defaultCreds = await getDefaultConnectionCredentials(userId);
    if (!defaultCreds) {
      throw new SendMailError(
        "No email connection found. Please add an email account in settings.",
        400,
      );
    }
    credentials = defaultCreds;
    resolvedConnectionId = defaultCreds.connectionId;
  }

  if (!credentials) {
    throw new SendMailError("Email credentials not found", 400);
  }

  const transporter = nodemailer.createTransport({
    host: credentials.smtp.host,
    port: credentials.smtp.port,
    secure: credentials.smtp.port === 465,
    auth: buildSmtpAuth(credentials),
  });

  const fromAddress = credentials.sendAsEmail || credentials.email;

  // Convert markdown to email HTML if no html was explicitly provided
  let emailHtml = html;
  let displayHtml = html;
  let inlineImageIds: string[] = [];
  if (!html && text) {
    const converted = convertMarkdownToEmailHtml(text);
    emailHtml = converted.emailHtml;
    displayHtml = converted.displayHtml;
    inlineImageIds = converted.inlineImageIds;
  }

  // Load attachments if provided
  const loaded = await loadAttachmentsForSend(
    attachmentIds || [],
    userId,
    inlineImageIds,
  );

  const result = await transporter.sendMail({
    from: fromAddress,
    ...(recipients.length > 0 && { to: recipients }),
    ...(ccRecipients.length > 0 && { cc: ccRecipients.join(", ") }),
    ...(bccRecipients.length > 0 && { bcc: bccRecipients.join(", ") }),
    subject,
    text,
    html: emailHtml,
    ...(inReplyTo && { inReplyTo }),
    ...(references &&
      references.length > 0 && {
        references: references.join(" "),
      }),
    ...(loaded.nodemailerAttachments.length > 0 && {
      attachments: loaded.nodemailerAttachments,
    }),
  });

  // Thread like ingest: reuse a related thread, root-fall-back to our own
  // Message-ID, and back-fill the conversation so a null-threadId anchor
  // joins the reply's thread.
  const threadId = await assignThreadId({
    userId,
    messageId: result.messageId || null,
    inReplyTo: inReplyTo || null,
    references: references || [],
  });

  await createLocalSentMessage({
    userId,
    emailConnectionId: resolvedConnectionId,
    messageId: result.messageId || null,
    threadId,
    inReplyTo: inReplyTo || null,
    references: references || [],
    subject,
    fromAddress,
    toAddresses: recipients,
    ccAddresses: ccRecipients,
    bccAddresses: bccRecipients,
    text,
    html: displayHtml,
    attachmentIds: loaded.ids,
  });

  // The mail is out and persisted; drop the originating draft. A failure here
  // must not turn a successful send into an error response — the client's own
  // delete (if any) or a manual delete can still clean up.
  if (draft) {
    try {
      await deleteDraftForUser(userId, draft.type, draft.contextMessageId);
    } catch (err) {
      console.error("Draft cleanup after send failed:", err);
    }
  }

  // Auto-create contacts for every recipient across To/Cc/Bcc (fire-and-forget)
  for (const recipient of [...recipients, ...ccRecipients, ...bccRecipients]) {
    findOrCreateContactForEmail(userId, recipient).catch((err) => {
      console.error("Auto-create contact failed:", err);
    });
  }

  // Append to IMAP Sent folder (fire-and-forget)
  appendToImapSent({
    emailConnectionId: resolvedConnectionId,
    messageId: result.messageId || null,
    inReplyTo: inReplyTo || null,
    references: references || [],
    subject,
    fromAddress,
    toAddresses: recipients,
    ccAddresses: ccRecipients,
    bccAddresses: bccRecipients,
    text,
    html: emailHtml,
    attachments: loaded.sentAttachments,
  }).catch(console.error);

  return { messageId: result.messageId };
}
