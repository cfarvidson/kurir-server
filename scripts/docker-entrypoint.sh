#!/bin/sh
set -e

# Schema policy:
# - Completely empty database (fresh self-host install): bootstrap the schema
#   with `prisma db push`, then apply every ad-hoc SQL migration.
# - Anything else: schema changes are applied as explicit SQL (run manually
#   via `kamal app exec`). `prisma db push` must stay disabled for non-empty
#   databases because the production DB contains tables from an unrelated app
#   that Prisma would otherwise try to drop.
#
# DATABASE_URL may carry Prisma-only query params (e.g. connection_limit)
# that psql rejects, so strip the query string before handing it to psql.
PSQL_URL="${DATABASE_URL%%\?*}"
TABLE_COUNT=$(psql "$PSQL_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'" 2>/dev/null || echo "")

if [ "$TABLE_COUNT" = "0" ]; then
    echo "==> Empty database detected; bootstrapping schema with prisma db push..."
    prisma db push
    echo "==> Applying SQL migrations..."
    for migration in prisma/migrations/*.sql; do
        echo "==> Applying $migration"
        psql "$PSQL_URL" -v ON_ERROR_STOP=1 -q -f "$migration"
    done
    echo "==> Migrations complete."
else
    echo "==> Running database migrations..."
    if ! prisma db execute --file prisma/migrations/search_vector.sql; then
        echo "WARNING: search_vector migration failed; continuing boot" >&2
    fi
    echo "==> Migrations complete."
fi

exec "$@"
