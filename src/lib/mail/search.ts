import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const SEARCH_SELECT_COLUMNS = [
  "id",
  "subject",
  "snippet",
  "fromAddress",
  "fromName",
  "toAddresses",
  "ccAddresses",
  "receivedAt",
  "isRead",
  "hasAttachments",
  "snoozedUntil",
  "followUpAt",
  "isInImbox",
  "isInFeed",
  "isInPaperTrail",
  "isArchived",
  "isSnoozed",
  "isFollowUp",
] as const;

export interface MessageSearchResult {
  id: string;
  subject: string | null;
  snippet: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  receivedAt: Date;
  isRead: boolean;
  hasAttachments: boolean;
  snoozedUntil: Date | null;
  followUpAt: Date | null;
  isInImbox: boolean;
  isInFeed: boolean;
  isInPaperTrail: boolean;
  isArchived: boolean;
  isSnoozed: boolean;
  isFollowUp: boolean;
  isSent: boolean;
}

function searchSelectSql(): Prisma.Sql {
  // Quote camelCase identifiers for PostgreSQL; leave lowercase unquoted.
  const list = SEARCH_SELECT_COLUMNS.map((col) =>
    /[A-Z]/.test(col) ? `"${col}"` : col,
  ).join(", ");
  return Prisma.raw(list);
}

/**
 * Build a prefix tsquery from user input.
 * "some thing" → "some:* & thing:*"
 * This enables partial matching: "some" finds "someparts".
 */
export function buildPrefixQuery(input: string): string {
  const words = input
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 20);
  if (words.length === 0) return "";
  return words.map((w) => `${w}:*`).join(" & ");
}

export async function searchMessages(
  userId: string,
  query: string,
  categoryFilter: Prisma.Sql,
  limit = 50,
): Promise<MessageSearchResult[]> {
  const prefixQuery = buildPrefixQuery(query);
  if (!prefixQuery) return [];

  return db.$queryRaw<MessageSearchResult[]>(Prisma.sql`
    SELECT ${searchSelectSql()},
      EXISTS (
        SELECT 1 FROM "Folder" f
        WHERE f.id = "Message"."folderId" AND (
          f."specialUse" = 'sent' OR f.path ILIKE '%sent%'
        )
      ) AS "isSent"
    FROM "Message"
    WHERE "userId" = ${userId}
      AND "search_vector" @@ to_tsquery('english', ${prefixQuery})
      ${categoryFilter}
    ORDER BY
      ts_rank("search_vector", to_tsquery('english', ${prefixQuery})) DESC,
      "receivedAt" DESC
    LIMIT ${limit}
  `);
}
