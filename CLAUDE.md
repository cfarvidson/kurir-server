# Kurir Server

Hey.com-inspired email client. Next.js 15, NextAuth v5 beta, Prisma 6, PostgreSQL 16, IMAP/SMTP via ImapFlow + nodemailer.

## Commands

```bash
pnpm dev          # Dev server (Turbopack, port 3000)
pnpm build        # Production build
pnpm lint         # ESLint 10 via flat config (eslint.config.mjs)
pnpm db:push      # Push Prisma schema to DB
pnpm db:generate  # Regenerate Prisma client
pnpm db:studio    # Prisma Studio GUI
pnpm add-user     # CLI: add user with IMAP/SMTP config
pnpm sync-user    # CLI: trigger sync for user(s)
pnpm backup       # Create backup archive (pg + redis + env)
pnpm restore      # Restore from backup archive
```

## Architecture

**Route groups:** `(auth)` for login/setup (unprotected), `(mail)` for mail pages (protected by middleware).

**Auth split:** `auth.config.ts` is edge-safe (used by middleware), `auth.ts` has full Node.js deps (Credentials provider + IMAP verification). Middleware can't import anything using Node.js `crypto`.

**Categorization (Hey.com model):** New senders land in Screener. User approves → sender gets a category (IMBOX, FEED, PAPER_TRAIL). Messages have boolean flags: `isInImbox`, `isInFeed`, `isInPaperTrail`, `isArchived`, `isInScreener`.

**Server actions pattern:** Auth check → ownership verification → DB mutation (often `$transaction`) → `revalidateTag`/`revalidatePath`.

**IMAP sync:** Batched UID delta strategy. `withImapConnection(userId, fn)` handles connection boilerplate. ImapFlow fetch uses `"minUid:*"` range format (comma-separated UIDs return empty iterators).

**Search:** PostgreSQL full-text search via `search_vector` tsvector column + GIN index + trigger. Queried via `$queryRaw` with `websearch_to_tsquery`.

**Threading:** `threadId` field computed by `repairThreadIds()` after sync. Thread collapsing in list views via `collapseToThreads()`.

## Key Files

- `src/lib/mail/sync-service.ts` — IMAP sync engine
- `src/lib/mail/imap-client.ts` — `withImapConnection` helper
- `src/lib/mail/threads.ts` — Thread grouping/retrieval
- `src/lib/mail/search.ts` — FTS query function
- `src/actions/` — Server actions (senders, archive, reply)
- `src/components/mail/` — Email UI components
- `src/components/layout/sidebar.tsx` — Navigation with badge counts
- `prisma/schema.prisma` — Data model

## Conventions

- **Language:** All UI text, labels, and messages must be in English (for now)
- Path alias: `@/` → `src/`
- Icons: `lucide-react`
- Styling: Tailwind CSS with HSL variables, shadcn-style UI components (CVA)
- Files: kebab-case. Components: PascalCase exports
- All DB queries filter by `userId` (multi-tenant)
- `revalidateTag("sidebar-counts")` after mutations that change category counts

## Docker

```bash
docker compose up -d                    # Start services
docker compose restart app              # Pick up code changes
docker compose exec postgres psql -U kurir  # DB access
```

Bind mount `.:/app` with anonymous volumes for `node_modules`/`.next`. Needs `corepack prepare pnpm@9.15.0 --activate` and `pnpm db:generate` in Dockerfile dev stage.

## Kamal (Production Deployment)

```bash
kamal setup                         # First deploy: provisions server, boots accessories + app
kamal deploy                        # Subsequent deploys
kamal app logs -f                   # Tail production logs
kamal app exec -i node              # Node REPL in production container
kamal app exec "prisma db push"              # Push schema changes
kamal accessory details db          # Check postgres status
kamal accessory logs db -f          # Tail postgres logs
kamal accessory exec db "psql -U kurir" # DB shell
```

Config: `config/deploy.yml`. Secrets: `.kamal/secrets` (env var refs only, safe for git). Set `KAMAL_*` prefixed env vars locally (see `DEPLOY.md`).

Registry and Postgres host are configured per-environment in `config/deploy.yml` (see `config/deploy.yml.example`).

Post-deploy hook auto-runs `prisma db push`. Search vector migration must be run manually once: `kamal app exec "npx prisma db execute --file prisma/migrations/search_vector.sql"`.

## Releasing

CalVer `YYYY.MM.DD` (e.g., `2026.04.01`). Use `/bump` to create a release. See `docs/releasing.md` for details.

## Gotchas

- **ImapFlow comma-separated UIDs:** `client.fetch("256,255", {uid:true})` returns empty. Use `"minUid:*"` range + filter in loop.
- **`prisma db push`** won't drop the `search_vector` column (Prisma ignores unknown columns), but `--force-reset` would.
- **Sent messages:** `processMessage` must check `isInbox` param before setting category flags.
- **Build:** `pnpm build` may fail at "Collecting page data" with `tracingChannel` error (ImapFlow/Node.js compat issue). TypeScript compilation still passes.
- **Stuck sync lock:** If sync crashes, `isSyncing` stays `true` and blocks future syncs ("Sync already in progress"). Stale lock auto-clears after 5 minutes, or fix manually: `docker compose exec postgres psql -U kurir -c 'UPDATE "SyncState" SET "isSyncing" = false;'`
- No test framework configured yet.

## Workflow

- **Do not create new branches or PRs.** Commit directly to the current branch. The user will handle branch management and PR creation.
