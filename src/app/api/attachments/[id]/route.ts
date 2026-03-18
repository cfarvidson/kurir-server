import { NextRequest, NextResponse } from "next/server";
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
          folder: { select: { path: true } },
        },
      },
    },
  });

  if (!attachment || attachment.message.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { message } = attachment;

  // Download only the specific MIME part via ImapFlow — no full source fetch needed
  const content = await withImapConnection(
    message.emailConnectionId,
    async (client) => {
      const mailbox = await client.getMailboxLock(message.folder.path);
      try {
        const { content: stream } = await client.download(
          String(message.uid),
          attachment.partId,
          { uid: true }
        );
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(chunk as Buffer);
        }
        return Buffer.concat(chunks);
      } finally {
        mailbox.release();
      }
    }
  );

  if (!content) {
    return NextResponse.json(
      { error: "Failed to fetch attachment" },
      { status: 502 }
    );
  }

  return new NextResponse(new Uint8Array(content), {
    headers: {
      "Content-Type": attachment.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.filename)}"`,
      "Content-Length": String(content.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
