import { NextResponse } from "next/server";
import { auth, getUserCredentials } from "@/lib/auth";
import { db } from "@/lib/db";
import { createLocalSentMessage } from "@/lib/mail/persist-sent";
import nodemailer from "nodemailer";
import { z } from "zod";

const sendSchema = z.object({
  to: z.string().email(),
  subject: z.string().optional().default(""),
  text: z.string().optional().default(""),
  html: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const credentials = await getUserCredentials(session.user.id);

  if (!credentials) {
    return NextResponse.json(
      { error: "Email credentials not found" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const parsed = sendSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { to, subject, text, html, inReplyTo, references } = parsed.data;

  const transporter = nodemailer.createTransport({
    host: credentials.smtp.host,
    port: credentials.smtp.port,
    secure: credentials.smtp.port === 465,
    auth: {
      user: credentials.email,
      pass: credentials.password,
    },
  });

  try {
    const result = await transporter.sendMail({
      from: credentials.email,
      to,
      subject,
      text,
      html,
      ...(inReplyTo && { inReplyTo }),
      ...(references && references.length > 0 && {
        references: references.join(" "),
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

    // Persist sent message to DB so it appears immediately
    await createLocalSentMessage({
      userId: session.user.id,
      messageId: result.messageId || null,
      threadId,
      inReplyTo: inReplyTo || null,
      references: references || [],
      subject,
      fromAddress: credentials.email,
      toAddresses: [to],
      text,
      html,
    });

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error) {
    console.error("Failed to send email:", error);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}
