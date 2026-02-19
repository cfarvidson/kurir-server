# Message Search

**Date:** 2026-02-16
**Status:** Brainstorm complete

## What We're Building

A search feature that lets users find messages by subject and body text, scoped to the current category view (Imbox, Feed, Paper Trail, etc.). The search input lives in each page's header bar and filters the message list in place while updating the URL with `?q=term` for shareability.

## Why This Approach

- **Scoped to current view:** Users are already in a mental context (e.g. "I'm looking at my Imbox"). Searching within that context is more intuitive than a global search that mixes categories.
- **In-page-header input:** Keeps the UI clean — no new pages or overlays. The search bar appears alongside the page title, consistent with the existing header layout.
- **Instant filter + URL:** Combines the responsiveness of in-place filtering with the utility of bookmarkable/shareable search URLs.
- **PostgreSQL FTS over ILIKE:** With 10k+ messages and body text search, ILIKE would do sequential scans. PostgreSQL's `tsvector`/`tsquery` with a GIN index provides fast, ranked results without adding infrastructure.

## Key Decisions

1. **Search scope:** Scoped to current category (the existing boolean filter like `isInImbox` is combined with the search query)
2. **Search fields:** `subject` and `textBody` (plain text body)
3. **Search backend:** PostgreSQL full-text search (`tsvector`/`tsquery`) with a GIN index
4. **UI placement:** Search input in the page header bar, next to the page title
5. **Results display:** Filters message list in place, updates URL with `?q=` query param
6. **Prisma integration:** Use `$queryRaw` since Prisma doesn't natively support FTS operators
7. **Index maintenance:** Populate the tsvector column during IMAP sync (in `processMessage`)

## Technical Shape

### Database

- Add a `searchVector` column (`tsvector`) to the `Message` model (or add via raw SQL since Prisma doesn't support `tsvector` natively)
- Create a GIN index on the search vector
- Weight subject higher than body (`setweight(to_tsvector(subject), 'A') || setweight(to_tsvector(textBody), 'B')`)

### API

- Search API route at `/api/mail/search?q=term&category=imbox` (GET)
- Uses `$queryRaw` with `to_tsquery` for the search and `ts_rank` for ordering
- Falls back to existing category boolean filters to scope results

### UI

- Search input component in each mail page header
- Debounced input → updates URL `?q=` param → triggers server re-fetch
- Reuse existing `MessageList` component for rendering results
- Show result count in the header

## Open Questions

- Should we also search `fromName`/`fromAddress`? (Could add to tsvector or handle separately)
- Highlight matching terms in results? (Nice to have, not MVP)
- Minimum query length before searching? (2-3 chars typical)
