---
title: Message Search with PostgreSQL Full-Text Search
date: 2026-02-16
category: feature-implementations
tags: [search, postgresql, full-text-search, tsvector, prisma, next.js, server-components]
module: mail
symptoms:
  - Need to search messages by subject and body
  - ILIKE too slow for 10k+ messages
  - Prisma does not support tsvector natively
---

# Message Search with PostgreSQL Full-Text Search

## Problem

Users need to search messages by subject and body text across 10k+ messages. Simple `ILIKE` queries do sequential scans and are too slow. Prisma has no native support for PostgreSQL's `tsvector`/`tsquery` types.

## Solution

Use PostgreSQL's built-in full-text search with a `tsvector` column, GIN index, and database trigger — accessed via Prisma's `$queryRaw`. No external search infrastructure needed.

### Architecture

```
SearchInput (client) → debounce 300ms → router.replace("?q=term")
    → Next.js server component re-renders with searchParams.q
    → searchMessages() via $queryRaw with websearch_to_tsquery
    → MessageList renders results
```

Key architectural decisions:
- **Server components + URL searchParams** instead of a separate API route. The URL is the state — bookmarkable, shareable, browser back/forward works.
- **Database trigger** instead of application-level tsvector maintenance. Prisma's `message.create()` can't set a tsvector column, but a BEFORE INSERT trigger handles it transparently. No changes to `processMessage` needed.
- **`websearch_to_tsquery`** instead of `to_tsquery` or `plainto_tsquery`. Handles user input safely — supports quotes, `-` exclusion, doesn't crash on special characters like `it's` or `&`.

### Database Layer

**File:** `prisma/migrations/search_vector.sql`

The migration adds:
1. A `search_vector tsvector` column on Message
2. A GIN index for fast lookups
3. A trigger function that auto-computes the vector on INSERT/UPDATE
4. A batched backfill for existing messages

Weight hierarchy: Subject (A) > Sender name (B) > Body text (C).

```sql
-- Trigger function
CREATE OR REPLACE FUNCTION message_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.subject, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW."fromName", '')), 'B') ||
    setweight(to_tsvector('english',
      CASE
        WHEN NEW."textBody" IS NOT NULL AND NEW."textBody" != ''
          THEN NEW."textBody"
        WHEN NEW."htmlBody" IS NOT NULL
          THEN regexp_replace(NEW."htmlBody", '<[^>]+>', ' ', 'g')
        ELSE ''
      END
    ), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
```

Run with:
```bash
docker compose exec -T postgres psql -U kurir < prisma/migrations/search_vector.sql
```

### Search Function

**File:** `src/lib/mail/search.ts`

Each page passes its own category filter as a `Prisma.Sql` fragment — no abstraction over category names, no `Prisma.raw()`.

```typescript
export async function searchMessages(
  userId: string,
  query: string,
  categoryFilter: Prisma.Sql,
  limit = 50
): Promise<MessageSearchResult[]> {
  return db.$queryRaw<MessageSearchResult[]>(Prisma.sql`
    SELECT id, subject, snippet, "fromAddress", "fromName",
      "receivedAt", "isRead", "hasAttachments"
    FROM "Message"
    WHERE "userId" = ${userId}
      AND "search_vector" @@ websearch_to_tsquery('english', ${query})
      ${categoryFilter}
    ORDER BY
      ts_rank("search_vector", websearch_to_tsquery('english', ${query})) DESC,
      "receivedAt" DESC
    LIMIT ${limit}
  `);
}
```

Called from each page like:
```typescript
await searchMessages(userId, q, Prisma.sql`AND "isInImbox" = true`)
```

### Search Input Component

**File:** `src/components/mail/search-input.tsx`

A client component placed in each page's header. Debounces input (300ms), updates URL via `router.replace`, syncs with browser back/forward via `useSearchParams`. Escape to clear, X button to clear.

### Page Integration Pattern

Each mail page (Imbox, Feed, Paper Trail, Archive, Sent) follows this pattern:

```typescript
export default async function SomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const isSearching = !!(q && q.length >= 2);

  const messages = isSearching
    ? await searchMessages(userId, q, Prisma.sql`AND "isInSomething" = true`)
    : await getNormalMessages(userId);
  // ...
}
```

When searching: thread collapsing is skipped, Imbox read/unread split is flattened.

## Gotchas

### Prisma and tsvector coexistence

The `search_vector` column is invisible to Prisma schema — it's not declared in `schema.prisma`. This is fine: Prisma ignores unknown columns, and `prisma db push` will not drop columns it doesn't know about (only `--force-reset` would). The column is accessed exclusively via `$queryRaw`.

### Backfill trick with triggers

The backfill uses `UPDATE "Message" SET subject = subject` (a no-op update) to fire the BEFORE UPDATE trigger, which computes `search_vector`. This avoids duplicating the tsvector computation logic in the backfill SQL.

### HTML-only emails

Some emails have `htmlBody` but no `textBody`. The trigger uses a `CASE` expression to fall back to a regex-stripped version of the HTML body. The regex `regexp_replace(html, '<[^>]+>', ' ', 'g')` removes tags but leaves content from `<style>` and `<script>` blocks — acceptable for FTS.

### fromAddress excluded from tsvector

Email addresses tokenize poorly in PostgreSQL FTS (`to_tsvector('english', 'john@example.com')` doesn't produce useful tokens). `fromName` is included at weight B instead. If address search is needed, use a separate `ILIKE` clause.

### Sent page has a different filter shape

All other pages filter by boolean flags (`isInImbox`, `isInFeed`, etc.). Sent filters by `folderId`. The `searchMessages` function handles both because each caller passes its own `Prisma.Sql` fragment.

### COALESCE vs CASE for body text fallback

`COALESCE(textBody, regexp_replace(htmlBody, ...))` doesn't work correctly because the inner `regexp_replace` on a NULL `htmlBody` (after COALESCE to `''`) returns an empty string, never NULL — so the outer COALESCE never reaches the third argument. Use `CASE WHEN` instead.

## Files

| File | Purpose |
|------|---------|
| `prisma/migrations/search_vector.sql` | tsvector column, GIN index, trigger, backfill |
| `src/lib/mail/search.ts` | `searchMessages()` function using `$queryRaw` |
| `src/components/mail/search-input.tsx` | Debounced search input client component |
| `src/app/(mail)/imbox/page.tsx` | Imbox search integration |
| `src/app/(mail)/feed/page.tsx` | Feed search integration |
| `src/app/(mail)/paper-trail/page.tsx` | Paper Trail search integration |
| `src/app/(mail)/archive/page.tsx` | Archive search integration |
| `src/app/(mail)/sent/page.tsx` | Sent search integration (folder-based) |

## Related

- [PostgreSQL Full-Text Search docs](https://www.postgresql.org/docs/current/textsearch.html)
- `docs/brainstorms/2026-02-16-message-search-brainstorm.md`
- `docs/plans/2026-02-16-feat-message-search-plan.md`
