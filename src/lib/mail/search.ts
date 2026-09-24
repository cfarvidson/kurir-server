import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  searchCategoryFilter,
  searchCategoryForScope,
  type MailSearchQuery,
  type SearchCategory,
} from "@/lib/mail/list-contract";

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
  "isFlagged",
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
  isFlagged: boolean;
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

export type SearchConstraints = {
  from?: string | null;
  domain?: string | null;
  hasAttachment?: boolean;
  after?: Date | null;
  before?: Date | null;
};

export function normalizeSearchFrom(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim().toLowerCase() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeSearchDomain(
  raw: string | null | undefined,
): string | null {
  let trimmed = raw?.trim().toLowerCase() ?? "";
  if (trimmed.startsWith("@")) trimmed = trimmed.slice(1);
  if (!trimmed || trimmed.includes(" ") || !trimmed.includes(".")) return null;
  return trimmed;
}

export function parseSearchDate(raw: string | null | undefined): Date | null {
  if (!raw?.trim()) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function constraintsAreEmpty(constraints: SearchConstraints): boolean {
  return (
    !normalizeSearchFrom(constraints.from) &&
    !normalizeSearchDomain(constraints.domain) &&
    !constraints.hasAttachment &&
    !constraints.after &&
    !constraints.before
  );
}

/** Whether the URL carries a chip filter that can stand without a query. */
export function hasSearchConstraints(params: MailSearchQuery): boolean {
  return !constraintsAreEmpty({
    from: params.from,
    domain: params.domain,
    hasAttachment: params.hasAttachment === "true",
    after: parseSearchDate(params.after),
    before: parseSearchDate(params.before),
  });
}

function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Extra AND-clauses for chip filters. Empty when every chip is idle. */
export function searchConstraintFilter(
  constraints: SearchConstraints,
): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  const from = normalizeSearchFrom(constraints.from);
  if (from) {
    // Part of the address or of the display name: "monika" is enough.
    const pattern = likeContains(from);
    parts.push(
      Prisma.sql`AND (LOWER("fromAddress") LIKE ${pattern} OR LOWER(COALESCE("fromName", '')) LIKE ${pattern})`,
    );
  }
  const domain = normalizeSearchDomain(constraints.domain);
  if (domain) {
    parts.push(
      Prisma.sql`AND LOWER(SPLIT_PART("fromAddress", '@', 2)) = ${domain}`,
    );
  }
  if (constraints.hasAttachment) {
    parts.push(Prisma.sql`AND "hasAttachments" = true`);
  }
  if (constraints.after) {
    parts.push(Prisma.sql`AND "receivedAt" >= ${constraints.after}`);
  }
  if (constraints.before) {
    parts.push(Prisma.sql`AND "receivedAt" <= ${constraints.before}`);
  }
  if (parts.length === 0) return Prisma.empty;
  return parts.reduce((sql, part) => Prisma.sql`${sql} ${part}`);
}

export function mergeSearchFilters(
  categoryFilter: Prisma.Sql,
  constraints: SearchConstraints,
): Prisma.Sql {
  if (constraintsAreEmpty(constraints)) return categoryFilter;
  return Prisma.sql`${categoryFilter} ${searchConstraintFilter(constraints)}`;
}

export function searchFilterSql(
  currentList: SearchCategory,
  params: MailSearchQuery,
): Prisma.Sql {
  return mergeSearchFilters(
    searchCategoryFilter(
      searchCategoryForScope(currentList, params.scope, params.list),
    ),
    {
      from: params.from,
      domain: params.domain,
      hasAttachment: params.hasAttachment === "true",
      after: parseSearchDate(params.after),
      before: parseSearchDate(params.before),
    },
  );
}

/**
 * Full-text hits for `query`, ranked. With `constrained` (a chip filter is
 * part of `categoryFilter`) an empty query lists the filtered mail newest
 * first instead, so "everything from monika" needs no search words.
 */
export async function searchMessages(
  userId: string,
  query: string,
  categoryFilter: Prisma.Sql,
  limit = 50,
  options: { constrained?: boolean } = {},
): Promise<MessageSearchResult[]> {
  const prefixQuery = buildPrefixQuery(query);
  if (!prefixQuery && !options.constrained) return [];

  // 'simple' matches the search_vector trigger (0032): no stemming, no
  // stop words, so a Swedish prefix matches exactly what was typed.
  const match = prefixQuery
    ? Prisma.sql`AND "search_vector" @@ to_tsquery('simple', ${prefixQuery})`
    : Prisma.empty;
  const rank = prefixQuery
    ? Prisma.sql`ts_rank("search_vector", to_tsquery('simple', ${prefixQuery})) DESC,`
    : Prisma.empty;

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
      ${match}
      ${categoryFilter}
    ORDER BY
      ${rank}
      "receivedAt" DESC
    LIMIT ${limit}
  `);
}
