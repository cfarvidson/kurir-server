import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { GROUP_PREFIXES, type FileGroup } from "@/lib/mail/file-types";

export interface FileRow {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: Date;
  message: {
    id: string;
    subject: string | null;
    receivedAt: Date;
    fromName: string | null;
    fromAddress: string;
  } | null;
}

export interface GetFilesOptions {
  group?: FileGroup | null;
  q?: string | null;
  cursor?: string | null;
  limit?: number;
}

const DEFAULT_LIMIT = 50;

/** Encode the pagination cursor as `<isoCreatedAt>_<attachmentId>`. */
export function encodeFileCursor(file: { createdAt: Date; id: string }): string {
  return `${file.createdAt.toISOString()}_${file.id}`;
}

/** Parse a file cursor into a Prisma where fragment, or null when malformed. */
export function parseFileCursor(
  cursor: string,
): Prisma.AttachmentWhereInput | null {
  const lastUnderscore = cursor.lastIndexOf("_");
  if (lastUnderscore === -1) return null;
  const dateStr = cursor.substring(0, lastUnderscore);
  const id = cursor.substring(lastUnderscore + 1);
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  if (!/^c[a-z0-9]{20,}$/.test(id)) return null;
  // Sort order: createdAt DESC, id DESC → "next" items sort later.
  return {
    OR: [{ createdAt: { lt: date } }, { createdAt: date, id: { lt: id } }],
  };
}

/** Build the contentType where-fragment for a file-type group. */
function buildGroupFilter(group: FileGroup): Prisma.AttachmentWhereInput {
  const conditions = (prefixes: string[]): Prisma.AttachmentWhereInput[] =>
    prefixes.map((p) => ({
      contentType: { startsWith: p, mode: Prisma.QueryMode.insensitive },
    }));

  if (group === "other") {
    const all = [
      ...GROUP_PREFIXES.image,
      ...GROUP_PREFIXES.archive,
      ...GROUP_PREFIXES.document,
    ];
    return { NOT: { OR: conditions(all) } };
  }
  return { OR: conditions(GROUP_PREFIXES[group]) };
}

/**
 * Fetch a page of the user's message attachments, newest first, with optional
 * type-group and filename-search filters. Read-only. Always scoped to the
 * user's own messages (multi-tenant).
 */
export async function getFiles(userId: string, options: GetFilesOptions = {}) {
  const { group, q, cursor, limit = DEFAULT_LIMIT } = options;

  const cursorCondition = cursor ? parseFileCursor(cursor) : undefined;
  if (cursor && !cursorCondition) return null;

  const trimmedQ = q?.trim();

  const and: Prisma.AttachmentWhereInput[] = [];
  if (group) and.push(buildGroupFilter(group));
  if (cursorCondition) and.push(cursorCondition);

  const where: Prisma.AttachmentWhereInput = {
    // Only attachments that belong to one of this user's messages. This also
    // excludes orphan upload rows (message-less drafts in progress).
    message: { is: { userId } },
    ...(trimmedQ
      ? {
          filename: {
            contains: trimmedQ,
            mode: Prisma.QueryMode.insensitive,
          },
        }
      : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };

  const rows = await db.attachment.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    // Deliberately omit the `content` blob — list views never need it.
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
        },
      },
    },
  });

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last ? encodeFileCursor(last) : null;

  return { files: rows as FileRow[], nextCursor };
}
