#!/bin/sh
set -e

echo "==> Running database migrations..."
prisma db push --skip-generate
prisma db execute --schema prisma/schema.prisma --file prisma/migrations/search_vector.sql 2>&1 || echo "WARNING: search_vector migration skipped (may already exist)" >&2
echo "==> Migrations complete."

exec "$@"
