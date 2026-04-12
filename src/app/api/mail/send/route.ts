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
import { findOrCreateContactForEmail } from "@/actions/contacts";
import nodemailer from "nodemailer";
import { z } from "zod";

const sendSchema = z.object({
  to: z.email(),
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
    subject,
    text,
    html,
    inReplyTo,
    references,
    fromConnectionId,
    attachmentIds,
  } = parsed.data;

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
      to,
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
      toAddresses: [to],
      text,
      html: displayHtml,
      attachmentIds: loaded.ids,
    });

    // Auto-create contact for recipient (fire-and-forget)
    findOrCreateContactForEmail(session.user.id, to).catch((err) => {
      console.error("Auto-create contact failed:", err);
    });

    // Append to IMAP Sent folder (fire-and-forget)
    appendToImapSent({
      emailConnectionId: resolvedConnectionId,
      messageId: result.messageId || null,
      inReplyTo: inReplyTo || null,
      references: references || [],
      subject,
      fromAddress,
      toAddresses: [to],
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
