import { db } from "@/lib/db";
import {
  asBodyBytes,
  decodeUploadedAttachmentData,
  EmptyAttachmentDataError,
} from "@/lib/mail/attachment-bytes";
import {
  applyUploadChunk,
  AttachmentUploadError,
  defaultAttachmentUploadStore,
  MAX_UPLOAD_BYTES,
  type UploadChunkInput,
} from "@/lib/mail/attachment-upload-session";
import { rateLimitUploads } from "@/lib/rate-limit";

export const MAX_PENDING_UPLOAD_BYTES = 25 * 1024 * 1024;

export type UploadPendingInput = Omit<UploadChunkInput, "userId">;

export type UploadPendingResult =
  | { ok: false; error: string }
  | { ok: true; complete: false; uploadId: string; receivedBytes: number }
  | {
      ok: true;
      complete: true;
      id: string;
      filename: string;
      contentType: string;
      size: number;
    };

export async function uploadPendingAttachment(
  userId: string,
  input: UploadPendingInput,
): Promise<UploadPendingResult> {
  const rl = await rateLimitUploads(userId);
  if (!rl.allowed) {
    return {
      ok: false,
      error: `Too many uploads - try again in ${rl.retryAfter} seconds`,
    };
  }

  const incomingBytes = incomingChunkLength(input.data);
  if (incomingBytes < 0) {
    return {
      ok: false,
      error: incomingBytes === -2 ? "Empty file" : "Invalid base64 data",
    };
  }

  const pendingTotal = await db.attachment.aggregate({
    where: { userId, messageId: null },
    _sum: { size: true },
  });
  const projected =
    (pendingTotal._sum.size || 0) +
    defaultAttachmentUploadStore.pendingBytes(userId) +
    incomingBytes;
  if (projected > MAX_PENDING_UPLOAD_BYTES) {
    return {
      ok: false,
      error:
        "Total pending uploads exceed 25MB. Send or remove existing attachments first.",
    };
  }

  let chunkResult;
  try {
    chunkResult = applyUploadChunk(defaultAttachmentUploadStore, {
      userId,
      filename: input.filename,
      contentType: input.contentType,
      data: input.data,
      uploadId: input.uploadId,
      done: input.done,
    });
  } catch (error) {
    if (error instanceof AttachmentUploadError) {
      return { ok: false, error: error.message };
    }
    if (error instanceof EmptyAttachmentDataError) {
      return { ok: false, error: "Empty file" };
    }
    return { ok: false, error: "Invalid base64 data" };
  }

  if (!chunkResult.complete) {
    return {
      ok: true,
      complete: false,
      uploadId: chunkResult.uploadId,
      receivedBytes: chunkResult.receivedBytes,
    };
  }

  if (chunkResult.bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File too large (max 5MB)" };
  }

  const attachment = await db.attachment.create({
    data: {
      filename: chunkResult.filename,
      contentType: chunkResult.contentType,
      size: chunkResult.bytes.length,
      content: asBodyBytes(chunkResult.bytes),
      userId,
    },
    select: {
      id: true,
      filename: true,
      contentType: true,
      size: true,
    },
  });

  return {
    ok: true,
    complete: true,
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size,
  };
}

/** Decoded incoming chunk size, or -1 invalid / -2 empty / 0 when omitted. */
function incomingChunkLength(data: string | undefined): number {
  if (data === undefined) return 0;
  try {
    return decodeUploadedAttachmentData(data).length;
  } catch (error) {
    if (error instanceof EmptyAttachmentDataError) return -2;
    return -1;
  }
}
