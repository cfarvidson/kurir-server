import { NextRequest, NextResponse } from "next/server";
import { simpleParser } from "mailparser";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withImapConnection } from "@/lib/mail/imap-client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Look up attachment with its parent message (need UID, folder, connection)
  const attachment = await db.attachment.findUnique({
    where: { id },
    include: {
      message: {
        select: {
          uid: true,
          userId: true,
          emailConnectionId: true,
          folder: { select: { name: true } },
        },
      },
    },
  });

  if (!attachment || attachment.message.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { message } = attachment;
  const partIndex = parseInt(attachment.partId, 10) - 1;

  // Fetch the message source from IMAP and extract the attachment
  const content = await withImapConnection(message.emailConnectionId, async (client) => {
    const mailbox = await client.getMailboxLock(message.folder.name);
    try {
      // Fetch full source for this specific UID
      const fetched = await client.fetchOne(String(message.uid), { source: true }, { uid: true });
      if (!fetched?.source) return null;

      const parsed = await simpleParser(fetched.source);
      const att = parsed.attachments?.[partIndex];
      if (!att) return null;

      return att.content;
    } finally {
      mailbox.release();
    }
  });

  if (!content) {
    return NextResponse.json(
      { error: "Failed to fetch attachment" },
      { status: 502 }
    );
  }

  return new NextResponse(content, {
    headers: {
      "Content-Type": attachment.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.filename)}"`,
      "Content-Length": String(content.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
