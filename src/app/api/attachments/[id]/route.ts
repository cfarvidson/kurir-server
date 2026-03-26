import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ImapFlow } from "imapflow";
import { getConnectionCredentials } from "@/lib/auth";
import { buildImapAuth } from "@/lib/mail/auth-helpers";

/**
 * Walk bodyStructure tree to find all non-text MIME parts.
 */
function findAttachmentParts(
  node: any,
  path: string = "",
): Array<{ partId: string; type: string; filename: string }> {
  if (node.childNodes) {
    return node.childNodes.flatMap((child: any, i: number) => {
      const childPath = path ? `${path}.${i + 1}` : String(i + 1);
      return findAttachmentParts(child, childPath);
    });
  }
  const disposition = node.disposition?.toLowerCase?.() ?? "";
  const filename =
    node.dispositionParameters?.filename || node.parameters?.name || "";
  const type = node.subtype
    ? `${node.type}/${node.subtype}`.toLowerCase()
    : (node.type || "").toLowerCase();
  if (
    disposition === "attachment" ||
    filename ||
    (disposition === "inline" && !type.startsWith("text/"))
  ) {
    return [{ partId: path || "1", type, filename }];
  }
  return [];
}

function isImageType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

function responseHeaders(attachment: {
  contentType: string;
  filename: string;
  size: number;
}) {
  const disposition = isImageType(attachment.contentType)
    ? "inline"
    : "attachment";
  return {
    "Content-Type": attachment.contentType || "application/octet-stream",
    "Content-Disposition": `${disposition}; filename="${encodeURIComponent(attachment.filename)}"`,
    ...(attachment.size ? { "Content-Length": String(attachment.size) } : {}),
    "Cache-Control": "private, max-age=86400",
  };
}

/** Check if the current user owns this attachment (via message or direct upload). */
function isOwner(
  attachment: {
    userId: string | null;
    message: { userId: string } | null;
  },
  userId: string,
): boolean {
  return attachment.userId === userId || attachment.message?.userId === userId;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const attachment = await db.attachment.findUnique({
    where: { id },
    include: {
      message: {
        select: {
          uid: true,
          userId: true,
          emailConnectionId: true,
          folder: { select: { path: true } },
        },
      },
    },
  });

  if (!attachment || !isOwner(attachment, session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Serve from cache/upload if content is available
  if (attachment.content) {
    return new NextResponse(attachment.content, {
      headers: responseHeaders(attachment),
    });
  }

  // User-uploaded attachments should always have content
  if (!attachment.partId || !attachment.message) {
    return NextResponse.json(
      { error: "Attachment content not available" },
      { status: 404 },
    );
  }

  // Otherwise fetch from IMAP, cache, and serve
  const { message } = attachment;

  const credentials = await getConnectionCredentials(
    message.emailConnectionId,
    session.user.id,
  );
  if (!credentials) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 500 },
    );
  }

  const client = new ImapFlow({
    host: credentials.imap.host,
    port: credentials.imap.port,
    secure: true,
    auth: buildImapAuth(credentials),
    logger: false,
  });

  try {
    await client.connect();
  } catch (err) {
    console.error("[attachments] IMAP connect failed:", err);
    return NextResponse.json(
      { error: "Failed to connect to mail server" },
      { status: 502 },
    );
  }

  let mailbox;
  try {
    mailbox = await client.getMailboxLock(message.folder.path);
  } catch (err) {
    console.error("[attachments] Mailbox lock failed:", err);
    await client.logout().catch(() => {});
    return NextResponse.json(
      { error: "Failed to open mailbox" },
      { status: 502 },
    );
  }

  try {
    let { content: imapStream } = await client.download(
      String(message.uid),
      attachment.partId,
      { uid: true },
    );

    let correctedPartId: string | null = null;

    // If stored partId returns nothing, try to find the correct part via bodyStructure
    if (!imapStream) {
      console.warn(
        `[attachments] partId=${attachment.partId} returned no content for uid=${message.uid}, attempting bodyStructure lookup`,
      );

      for await (const msg of client.fetch(
        String(message.uid),
        { bodyStructure: true },
        { uid: true },
      )) {
        if (msg.bodyStructure) {
          const parts = findAttachmentParts(msg.bodyStructure);
          const match =
            parts.find(
              (p) =>
                p.type === attachment.contentType.toLowerCase() &&
                p.filename === attachment.filename,
            ) ??
            parts.find((p) => p.type === attachment.contentType.toLowerCase());
          if (match) correctedPartId = match.partId;
        }
      }

      if (correctedPartId) {
        console.log(
          `[attachments] Found corrected partId=${correctedPartId} (was ${attachment.partId})`,
        );
        ({ content: imapStream } = await client.download(
          String(message.uid),
          correctedPartId,
          { uid: true },
        ));
      }
    }

    if (!imapStream) {
      console.error(
        `[attachments] No content found for uid=${message.uid} partId=${attachment.partId} folder=${message.folder.path}`,
      );
      mailbox.release();
      await client.logout().catch(() => {});
      return NextResponse.json(
        { error: "Attachment not found on mail server" },
        { status: 404 },
      );
    }

    // Buffer the content so we can cache it
    const chunks: Buffer[] = [];
    for await (const chunk of imapStream) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    const content = Buffer.concat(chunks);

    mailbox.release();
    await client.logout().catch(() => {});

    // Cache content (and fix partId if corrected) in the background
    db.attachment
      .update({
        where: { id: attachment.id },
        data: {
          content,
          ...(correctedPartId ? { partId: correctedPartId } : {}),
        },
      })
      .catch(() => {});

    return new NextResponse(content, {
      headers: {
        ...responseHeaders(attachment),
        "Content-Length": String(content.length),
      },
    });
  } catch (err) {
    console.error("[attachments] Download failed:", err);
    mailbox.release();
    await client.logout().catch(() => {});
    return NextResponse.json(
      { error: "Failed to fetch attachment" },
      { status: 502 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const attachment = await db.attachment.findUnique({
    where: { id },
    select: { userId: true, messageId: true },
  });

  if (!attachment || attachment.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only allow deleting unlinked (unsent) uploads
  if (attachment.messageId) {
    return NextResponse.json(
      { error: "Cannot delete an attachment that has been sent" },
      { status: 400 },
    );
  }

  await db.attachment.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
