import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUserId } from "@/lib/mobile/auth";
import { uploadPendingAttachment } from "@/lib/mail/attachment-upload";
import { rateLimitUploads, tooManyRequests } from "@/lib/rate-limit";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_PENDING_TOTAL = 25 * 1024 * 1024; // 25MB total pending uploads

export async function POST(request: NextRequest) {
  // Session cookie (web) or bearer token (mobile)
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return jsonChunkedUpload(request, userId);
  }

  return multipartUpload(request, userId);
}

async function jsonChunkedUpload(request: NextRequest, userId: string) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const result = await uploadPendingAttachment(userId, {
    filename: typeof record.filename === "string" ? record.filename : undefined,
    contentType:
      typeof record.contentType === "string" ? record.contentType : undefined,
    data: typeof record.data === "string" ? record.data : undefined,
    uploadId: typeof record.uploadId === "string" ? record.uploadId : undefined,
    done: typeof record.done === "boolean" ? record.done : undefined,
  });

  if (!result.ok) {
    const status = /too large|exceed/i.test(result.error) ? 413 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  if (!result.complete) {
    return NextResponse.json({
      uploadId: result.uploadId,
      receivedBytes: result.receivedBytes,
      complete: false,
    });
  }
  return NextResponse.json({
    id: result.id,
    filename: result.filename,
    contentType: result.contentType,
    size: result.size,
    url: `/api/attachments/${result.id}`,
    complete: true,
  });
}

async function multipartUpload(request: NextRequest, userId: string) {
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
