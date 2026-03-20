import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const message = await db.message.findUnique({
    where: { id },
    select: {
      htmlBody: true,
      textBody: true,
      userId: true,
    },
  });

  if (!message) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (message.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const html = message.htmlBody;
  const text = message.textBody;
  const sizeBytes = (html?.length ?? 0) + (text?.length ?? 0);

  return NextResponse.json({
    html,
    text,
    sizeBytes,
  });
}
