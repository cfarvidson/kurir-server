# Kurir Server

Hey.com-inspired email client. Next.js 15, NextAuth v5 beta, Prisma 6, PostgreSQL 16, IMAP/SMTP via ImapFlow + nodemailer.

**Building or modifying UI? Read `DESIGN.md` first** — it captures Kurir's design system (warm terracotta accent, Inter/Playfair typography, category colors, shadcn/CVA conventions, the no-avatars rule).

## Commands

```bash
pnpm dev          # Dev server (Turbopack, port 3000)
pnpm build        # Production build
pnpm lint         # ESLint 10 via flat config (eslint.config.mjs)
pnpm test         # Run test suite once (Vitest)
pnpm test:watch   # Vitest in watch mode
pnpm test:coverage # Vitest with V8 coverage
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

**Always invoke Kamal via `bin/deploy`, never bare `kamal`.** The wrapper sources the per-user secrets file (`~/.kamal/kurir-secrets.env`, mode `0600`) before exec'ing kamal. Using bare `kamal` from a shell that doesn't have every `KAMAL_*` env var set silently injects empty secrets into the container and wipes production config (broken Redis, missing OAuth, IMAP password decryption failures).

```bash
bin/deploy                          # Subsequent deploys (= kamal deploy)
bin/deploy app logs -f              # Tail production logs
bin/deploy app exec -i node         # Node REPL in production container
bin/deploy app exec --reuse "psql \"\$DATABASE_URL\" -c '...'"  # Apply schema changes
bin/deploy accessory details db     # Check postgres status
bin/deploy accessory logs db -f     # Tail postgres logs
```

Config: `config/deploy.yml`. Secret refs: `.kamal/secrets` (only `$KAMAL_*` references, safe for git). Actual values: `~/.kamal/kurir-secrets.env` (per-user, gitignored by being outside the repo).

If `~/.kamal/kurir-secrets.env` is missing, recover by inspecting the previously-running container:

```bash
bin/deploy server exec -p "docker inspect <prev-container-name> --format '{{range .Config.Env}}{{println .}}{{end}}'" | grep -E '^(DATABASE_URL|REDIS_URL|AUTH_SECRET|ENCRYPTION_KEY|VAPID_PRIVATE_KEY|MICROSOFT_|GOOGLE_|POSTGRES_PASSWORD)=' | sed 's/^/KAMAL_/' > ~/.kamal/kurir-secrets.env
chmod 600 ~/.kamal/kurir-secrets.env
```

Registry and Postgres host are configured per-environment in `config/deploy.yml` (see `config/deploy.yml.example`).

**Do not enable `prisma db push` in `scripts/docker-entrypoint.sh` or the post-deploy hook.** The production DB shares its instance with an unrelated `epoch` application's tables. `prisma db push` would try to drop those. Apply kurir-server schema changes as explicit SQL via `bin/deploy app exec --reuse "psql \"\$DATABASE_URL\" -c '...'"` (same pattern as `prisma/migrations/search_vector.sql`).

## Releasing

CalVer `YYYY.MM.DD` (e.g., `2026.04.01`). Use `/bump` to create a release. See `docs/releasing.md` for details.

**Always update `CHANGELOG.md` when bumping the version.** Add a new section at the top with the new tag, dated, grouped into `Added` / `Changed` / `Fixed` / `Removed` as applicable. Do this before the release commit so the tagged commit contains the updated changelog.

## Gotchas

- **ImapFlow comma-separated UIDs:** `client.fetch("256,255", {uid:true})` returns empty. Use `"minUid:*"` range + filter in loop.
- **`prisma db push`** won't drop the `search_vector` column (Prisma ignores unknown columns), but `--force-reset` would.
- **Sent messages:** `processMessage` must check `isInbox` param before setting category flags.
- **Build:** `pnpm build` may fail at "Collecting page data" with `tracingChannel` error (ImapFlow/Node.js compat issue). TypeScript compilation still passes.
- **Stuck sync lock:** If sync crashes, `isSyncing` stays `true` and blocks future syncs ("Sync already in progress"). Stale lock auto-clears after 5 minutes, or fix manually: `docker compose exec postgres psql -U kurir -c 'UPDATE "SyncState" SET "isSyncing" = false;'`
- **Tests:** Vitest. Unit tests in `src/__tests__/unit/`, integration in `src/__tests__/integration/`. Config in `vitest.config.mjs` (`@/` alias resolves). Run with `pnpm test`. Pure-function/policy modules (e.g. `src/lib/mail/attachment-types.ts`) are the highest-value coverage targets — keep security-sensitive classification logic tested.

## Workflow

- Ship changes on a new branch in a git worktree, then open a PR — don't commit feature work directly to `main`. Use the `cfarvidson/` branch prefix.
