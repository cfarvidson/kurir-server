import { NextResponse } from "next/server";
import {
  auth,
  getConnectionCredentials,
  getDefaultConnectionCredentials,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  createLocalSentMessage,
  appendToImapSent,
} from "@/lib/mail/persist-sent";
import { convertMarkdownToEmailHtml } from "@/lib/mail/markdown-to-email";
import { loadAttachmentsForSend } from "@/lib/mail/attachment-helpers";
import { buildSmtpAuth } from "@/lib/mail/auth-helpers";
import { parseRecipients } from "@/lib/mail/recipients";
import { findOrCreateContactForEmail } from "@/actions/contacts";
import nodemailer from "nodemailer";
import { z } from "zod";

const sendSchema = z.object({
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
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = sendSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

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
  } = parsed.data;

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
    return NextResponse.json(
      { error: `Invalid recipient address: ${allInvalid.join(", ")}` },
      { status: 400 },
    );
  }
  // A send must reach at least one recipient across any field (allows
  // group-only or Bcc-only sends with an empty To).
  if (
    recipients.length === 0 &&
    ccRecipients.length === 0 &&
    bccRecipients.length === 0
  ) {
    return NextResponse.json(
      { error: "No valid recipient address provided" },
      { status: 400 },
    );
  }

  // Resolve credentials: use specified connection or fall back to default
  let credentials;
  let resolvedConnectionId: string;

  if (fromConnectionId) {
    // Verify the connection belongs to this user
    const conn = await db.emailConnection.findFirst({
      where: { id: fromConnectionId, userId: session.user.id },
      select: { id: true },
    });
    if (!conn) {
      return NextResponse.json(
        { error: "Email connection not found" },
        { status: 404 },
      );
    }
    credentials = await getConnectionCredentials(
      fromConnectionId,
      session.user.id,
    );
    resolvedConnectionId = fromConnectionId;
  } else {
    const defaultCreds = await getDefaultConnectionCredentials(session.user.id);
    if (!defaultCreds) {
      return NextResponse.json(
        {
          error:
            "No email connection found. Please add an email account in settings.",
        },
        { status: 400 },
      );
    }
    credentials = defaultCreds;
    resolvedConnectionId = defaultCreds.connectionId;
  }

  if (!credentials) {
    return NextResponse.json(
      { error: "Email credentials not found" },
      { status: 400 },
    );
  }

  const transporter = nodemailer.createTransport({
    host: credentials.smtp.host,
    port: credentials.smtp.port,
    secure: credentials.smtp.port === 465,
    auth: buildSmtpAuth(credentials),
  });

  const fromAddress = credentials.sendAsEmail || credentials.email;

  try {
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
      session.user.id,
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

    // Compute threadId from references/inReplyTo if part of a thread
    let threadId: string | null = null;
    if (inReplyTo || (references && references.length > 0)) {
      const relatedIds = [...(references || [])];
      if (inReplyTo && !relatedIds.includes(inReplyTo)) {
        relatedIds.push(inReplyTo);
      }
      const existingThread = await db.message.findFirst({
        where: {
          userId: session.user.id,
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

    await createLocalSentMessage({
      userId: session.user.id,
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

    // Auto-create contacts for every recipient across To/Cc/Bcc (fire-and-forget)
    for (const recipient of [...recipients, ...ccRecipients, ...bccRecipients]) {
      findOrCreateContactForEmail(session.user.id, recipient).catch((err) => {
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

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error) {
    console.error("Failed to send email:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to send email",
      },
      { status: 500 },
    );
  }
}
