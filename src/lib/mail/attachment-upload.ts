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
import type { DraftRef } from "@/lib/mail/draft-context";
import { rateLimitUploads } from "@/lib/rate-limit";

/**
 * Cap on one mail's attachments: the draft's rows plus the incoming file. The
 * JSON path also still counts the user's in-flight chunk sessions
 * (`pendingBytes`), which are user-wide rather than per draft.
 */
export const MAX_PENDING_UPLOAD_BYTES = 25 * 1024 * 1024;

export const PER_MAIL_LIMIT_ERROR =
  "This mail's attachments would exceed the 25MB per mail limit. Remove an attachment first.";

export type UploadPendingInput = Omit<UploadChunkInput, "userId"> & {
  draft?: DraftRef;
};

export type UploadPendingResult =
  | { ok: false; error: string; retryAfter?: number }
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
  // A file is charged once: only the opening chunk (no uploadId) counts.
  // Continuation chunks for a session the server already holds pass through.
  if (!input.uploadId) {
    const rl = await rateLimitUploads(userId);
    if (!rl.allowed) {
      return {
        ok: false,
        error: `Too many uploads - try again in ${rl.retryAfter} seconds`,
        retryAfter: rl.retryAfter,
      };
    }
  }

  const incomingBytes = incomingChunkLength(input.data);
  if (incomingBytes < 0) {
    return {
      ok: false,
      error: incomingBytes === -2 ? "Empty file" : "Invalid base64 data",
    };
  }

  const projected =
    (await draftAttachmentBytes(userId, input.draft)) +
    defaultAttachmentUploadStore.pendingBytes(userId) +
    incomingBytes;
  if (projected > MAX_PENDING_UPLOAD_BYTES) {
    return { ok: false, error: PER_MAIL_LIMIT_ERROR };
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

/**
 * Bytes already attached to the draft being composed. Attachments on other
 * drafts, or on nothing, do not count. No draft named means nothing counts.
 */
export async function draftAttachmentBytes(
  userId: string,
  draft: DraftRef | undefined,
): Promise<number> {
  if (!draft) return 0;
  const row = await db.draft.findUnique({
    where: {
      userId_type_contextMessageId: {
        userId,
        type: draft.type,
        contextMessageId: draft.contextMessageId,
      },
    },
    select: { attachmentIds: true },
  });
  if (!row || row.attachmentIds.length === 0) return 0;
  const total = await db.attachment.aggregate({
    where: {
      id: { in: row.attachmentIds },
      OR: [{ userId }, { message: { userId } }],
    },
    _sum: { size: true },
  });
  return total._sum.size || 0;
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
