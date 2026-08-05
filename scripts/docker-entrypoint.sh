#!/bin/sh
set -e

# Schema policy:
# - Completely empty database (fresh self-host install): bootstrap the schema
#   with `prisma db push`, then run the migration runner (which records every
#   file as applied).
# - Anything else (existing self-host installs AND production): apply only the
#   versioned SQL migrations via scripts/apply-migrations.sh. `prisma db push`
#   must stay disabled for non-empty databases because the production DB
#   contains tables from an unrelated app that Prisma would otherwise drop.
#
# Every schema change MUST ship as a numbered idempotent SQL file in
# prisma/migrations/ alongside the schema.prisma change (CI enforces this) —
# otherwise existing self-host installs break on their next update.
#
# A failed migration aborts the boot on purpose: new app code against an old
# schema serves 500s while still passing the /api/up healthcheck, which is
# worse than a visible restart loop.

# DATABASE_URL may carry Prisma-only query params (e.g. connection_limit)
# that psql rejects, so strip the query string before handing it to psql.
PSQL_URL="${DATABASE_URL%%\?*}"
TABLE_COUNT=$(psql "$PSQL_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'" 2>/dev/null || echo "")

if [ "$TABLE_COUNT" = "0" ]; then
    echo "==> Empty database detected; bootstrapping schema with prisma db push..."
    prisma db push
fi

echo "==> Running database migrations..."
sh /app/scripts/apply-migrations.sh

exec "$@"
