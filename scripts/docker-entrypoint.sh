#!/bin/sh
set -e

# Schema changes are applied as explicit SQL (run manually via
# `kamal app exec`). `prisma db push` is intentionally disabled here
# because the production DB contains tables from a previous app that
# Prisma would otherwise try to drop.
echo "==> Running database migrations..."
prisma db execute --schema prisma/schema.prisma --file prisma/migrations/search_vector.sql 2>&1 || echo "WARNING: search_vector migration skipped (may already exist)" >&2
echo "==> Migrations complete."

exec "$@"
