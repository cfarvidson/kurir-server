import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUserId } from "@/lib/mobile/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Session cookie (web) or bearer token (mobile)
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const message = await db.message.findUnique({
    where: { id },
    select: {
      htmlBody: true,
      textBody: true,
      userId: true,
      // The web thread view lists all attachments (including inline/CID
      // ones) — mirror that contract for mobile.
      attachments: {
        select: {
          id: true,
          filename: true,
          contentType: true,
          size: true,
        },
      },
    },
  });

  if (!message) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (message.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const html = message.htmlBody;
  const text = message.textBody;
  const sizeBytes = (html?.length ?? 0) + (text?.length ?? 0);

  return NextResponse.json({
    html,
    text,
    sizeBytes,
    attachments: message.attachments,
  });
}
