#!/bin/sh
# Applies the versioned SQL migrations in prisma/migrations/ (NNNN_name.sql,
# sorted by filename) exactly once each, tracked in the "_kurir_migrations"
# table. Runs on every container boot via docker-entrypoint.sh.
#
# Migration files MUST be idempotent (IF NOT EXISTS guards etc.): databases
# that predate this runner (production, older self-host installs) already
# contain the changes, and the first tracked run re-applies every file.
# Files are immutable once shipped — fix mistakes with a new numbered file.
set -e

# DATABASE_URL may carry Prisma-only query params (e.g. connection_limit)
# that psql rejects, so strip the query string before handing it to psql.
PSQL_URL="${DATABASE_URL%%\?*}"

psql "$PSQL_URL" -v ON_ERROR_STOP=1 -q -c \
    'CREATE TABLE IF NOT EXISTS "_kurir_migrations" (
        "name" TEXT PRIMARY KEY,
        "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    );'

for migration in prisma/migrations/*.sql; do
    name=$(basename "$migration")
    applied=$(psql "$PSQL_URL" -tAc \
        "SELECT 1 FROM \"_kurir_migrations\" WHERE \"name\" = '$name'")
    if [ "$applied" = "1" ]; then
        continue
    fi
    echo "==> Applying migration $name"
    psql "$PSQL_URL" -v ON_ERROR_STOP=1 -q -f "$migration"
    psql "$PSQL_URL" -v ON_ERROR_STOP=1 -q -c \
        "INSERT INTO \"_kurir_migrations\" (\"name\") VALUES ('$name')
         ON CONFLICT (\"name\") DO NOTHING;"
done

echo "==> Migrations up to date."
