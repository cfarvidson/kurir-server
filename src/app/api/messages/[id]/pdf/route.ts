import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import ReactPDF from "@react-pdf/renderer";
import { buildEmailPdf } from "@/lib/mail/pdf";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const message = await db.message.findFirst({
    where: { id, userId: session.user.id },
    include: {
      sender: { select: { displayName: true, email: true } },
    },
  });

  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const senderName =
    message.sender?.displayName || message.fromName || message.fromAddress;

  const doc = buildEmailPdf({
    subject: message.subject || "(no subject)",
    from: `${senderName} <${message.fromAddress}>`,
    to: message.toAddresses.join(", "),
    cc: message.ccAddresses.join(", "),
    date: new Date(
      message.sentAt || message.receivedAt,
    ).toLocaleString(),
    body: message.textBody || "",
  });

  const stream = await ReactPDF.renderToStream(doc);

  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const buffer = Buffer.concat(chunks);

  const filename =
    (message.subject || "email")
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 60) + ".pdf";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
