import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { FileRow } from "@/lib/mail/files";

/** Files group in search: attachments shown before "see all in Files". */
export const SEARCH_FILES_LIMIT = 8;

/**
 * Files group of the main search (kurir-ios#117): the user's attachments
 * whose filename or sender (name or address) contains the query, newest
 * first. Opened directly (viewer or download), not through a new search.
 */
export function fileSearchWhere(
  userId: string,
  query: string,
): Prisma.AttachmentWhereInput {
  const q = query.trim();
  const insensitive = Prisma.QueryMode.insensitive;
  return {
    message: { is: { userId } },
    OR: [
      { filename: { contains: q, mode: insensitive } },
      { message: { is: { fromName: { contains: q, mode: insensitive } } } },
      { message: { is: { fromAddress: { contains: q, mode: insensitive } } } },
    ],
  };
}

export async function searchFiles(
  userId: string,
  query: string,
  limit = SEARCH_FILES_LIMIT,
): Promise<FileRow[]> {
  if (query.trim().length < 1) return [];
  const rows = await db.attachment.findMany({
    where: fileSearchWhere(userId, query),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    // No `content`: list rows never need the blob.
    select: {
      id: true,
      filename: true,
      contentType: true,
      size: true,
      createdAt: true,
      message: {
        select: {
          id: true,
          subject: true,
          receivedAt: true,
          fromName: true,
          fromAddress: true,
          isInImbox: true,
          isInFeed: true,
          isInPaperTrail: true,
          isArchived: true,
        },
      },
    },
  });
  return rows as FileRow[];
}
