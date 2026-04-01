import { db } from "@/lib/db";
import type { SentAttachment } from "./persist-sent";

const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25MB

export interface LoadedAttachments {
  nodemailerAttachments: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
    cid?: string;
  }>;
  sentAttachments: SentAttachment[];
  ids: string[];
}

/**
 * Load attachments from DB, verify ownership, build nodemailer arrays.
 * Inline images (those with matching IDs in inlineImageIds) get CID references.
 */
export async function loadAttachmentsForSend(
  attachmentIds: string[],
  userId: string,
  inlineImageIds: string[] = [],
): Promise<LoadedAttachments> {
  if (attachmentIds.length === 0) {
    return { nodemailerAttachments: [], sentAttachments: [], ids: [] };
  }

  const attachments = await db.attachment.findMany({
    where: {
      id: { in: attachmentIds },
      OR: [
        { userId }, // uploaded by user
        { message: { userId } }, // IMAP-synced, owned via message
      ],
    },
    select: {
      id: true,
      filename: true,
      contentType: true,
      size: true,
      content: true,
    },
  });

  // Verify all requested attachments were found and belong to user
  if (attachments.length !== attachmentIds.length) {
    throw new Error("One or more attachments not found or not owned by user");
  }

  // Check total size
  const totalSize = attachments.reduce((sum, a) => sum + a.size, 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    throw new Error("Total attachment size exceeds 25MB");
  }

  const nodemailerAttachments = attachments.map((a) => {
    const isInline = inlineImageIds.includes(a.id);
    return {
      filename: a.filename,
      content: Buffer.from(a.content!),
      contentType: a.contentType,
      ...(isInline && { cid: `${a.id}@kurir` }),
    };
  });

  const sentAttachments: SentAttachment[] = nodemailerAttachments.map((a) => ({
    filename: a.filename,
    content: a.content,
    contentType: a.contentType,
    ...(a.cid && { cid: a.cid }),
  }));

  return {
    nodemailerAttachments,
    sentAttachments,
    ids: attachments.map((a) => a.id),
  };
}
