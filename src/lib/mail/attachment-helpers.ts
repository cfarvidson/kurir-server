import { db } from "@/lib/db";
import { ImapFlow } from "imapflow";
import { getConnectionCredentialsInternal } from "@/lib/auth";
import { buildImapAuth } from "@/lib/mail/auth-helpers";
import { storedContentToBuffer } from "@/lib/mail/attachment-bytes";
import type { SentAttachment } from "./persist-sent";

const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25MB

export async function downloadAttachmentContent(attachment: {
  partId: string | null;
  message: {
    uid: number;
    emailConnectionId: string;
    folder: { path: string } | null;
  } | null;
}): Promise<Buffer | null> {
  if (!attachment.partId || !attachment.message?.folder) return null;
  const credentials = await getConnectionCredentialsInternal(
    attachment.message.emailConnectionId,
  );
  if (!credentials) return null;

  const client = new ImapFlow({
    host: credentials.imap.host,
    port: credentials.imap.port,
    secure: true,
    auth: buildImapAuth(credentials),
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(attachment.message.folder.path);
    try {
      const { content } = await client.download(
        String(attachment.message.uid),
        attachment.partId,
        { uid: true },
      );
      if (!content) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of content) {
        chunks.push(Buffer.from(chunk as Buffer));
      }
      return Buffer.concat(chunks);
    } finally {
      lock.release();
    }
  } catch {
    return null;
  } finally {
    await client.logout().catch(() => {});
  }
}

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
      partId: true,
      message: {
        select: {
          uid: true,
          emailConnectionId: true,
          folder: { select: { path: true } },
        },
      },
    },
  });

  // Verify all requested attachments were found and belong to user
  if (attachments.length !== attachmentIds.length) {
    throw new Error("One or more attachments not found or not owned by user");
  }

  const contents = new Map<string, Buffer>();
  for (const attachment of attachments) {
    const stored = storedContentToBuffer(attachment.content);
    if (stored) {
      contents.set(attachment.id, Buffer.from(stored));
      continue;
    }
    const fetched = await downloadAttachmentContent(attachment);
    if (!fetched) {
      throw new Error(
        `Attachment "${attachment.filename}" is not available. Open it once to cache it, then send again.`,
      );
    }
    contents.set(attachment.id, fetched);
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
      content: contents.get(a.id)!,
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
