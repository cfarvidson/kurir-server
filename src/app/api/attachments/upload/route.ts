import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { rateLimitUploads, tooManyRequests } from "@/lib/rate-limit";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_PENDING_TOTAL = 25 * 1024 * 1024; // 25MB total pending uploads

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Rate limit
  const rl = await rateLimitUploads(userId);
  if (!rl.allowed) {
    return tooManyRequests(rl.retryAfter);
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File too large (max 10MB)" },
      { status: 413 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }

  // Check total pending uploads for this user
  const pendingTotal = await db.attachment.aggregate({
    where: { userId, messageId: null },
    _sum: { size: true },
  });

  if ((pendingTotal._sum.size || 0) + file.size > MAX_PENDING_TOTAL) {
    return NextResponse.json(
      {
        error:
          "Total pending uploads exceed 25MB. Send or remove existing attachments first.",
      },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const attachment = await db.attachment.create({
    data: {
      filename: file.name || "untitled",
      contentType: file.type || "application/octet-stream",
      size: file.size,
      content: buffer,
      userId,
    },
  });

  return NextResponse.json({
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size,
    url: `/api/attachments/${attachment.id}`,
  });
}
