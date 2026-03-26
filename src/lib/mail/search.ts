import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export interface MessageSearchResult {
  id: string;
  subject: string | null;
  snippet: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  receivedAt: Date;
  isRead: boolean;
  hasAttachments: boolean;
}

/**
 * Build a prefix tsquery from user input.
 * "some thing" → "some:* & thing:*"
 * This enables partial matching: "some" finds "someparts".
 */
function buildPrefixQuery(input: string): string {
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
    SELECT
      id, subject, snippet, "fromAddress", "fromName", "toAddresses",
      "receivedAt", "isRead", "hasAttachments"
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
