import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ImapFlow } from "imapflow";
import { getConnectionCredentials } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

  if (!attachment || attachment.message.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { message } = attachment;

  const credentials = await getConnectionCredentials(message.emailConnectionId);
  if (!credentials) {
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 500 }
    );
  }

  const client = new ImapFlow({
    host: credentials.imap.host,
    port: credentials.imap.port,
    secure: true,
    auth: { user: credentials.email, pass: credentials.password },
    logger: false,
  });

  try {
    await client.connect();
  } catch (err) {
    console.error("[attachments] IMAP connect failed:", err);
    return NextResponse.json(
      { error: "Failed to connect to mail server" },
      { status: 502 }
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
      { status: 502 }
    );
  }

  try {
    const { content: imapStream } = await client.download(
      String(message.uid),
      attachment.partId,
      { uid: true }
    );

    // Stream the IMAP download directly to the response
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of imapStream) {
            controller.enqueue(new Uint8Array(chunk as Buffer));
          }
          controller.close();
        } catch (err) {
          console.error("[attachments] Stream error:", err);
          controller.error(err);
        } finally {
          mailbox.release();
          await client.logout().catch(() => {});
        }
      },
    });

    return new NextResponse(readable, {
      headers: {
        "Content-Type": attachment.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.filename)}"`,
        ...(attachment.size ? { "Content-Length": String(attachment.size) } : {}),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[attachments] Download failed:", err);
    mailbox.release();
    await client.logout().catch(() => {});
    return NextResponse.json(
      { error: "Failed to fetch attachment" },
      { status: 502 }
    );
  }
}
