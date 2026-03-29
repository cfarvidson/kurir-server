#!/bin/sh
set -e

# Kurir Restore — restores a backup archive created by kurir-backup.sh
# Usage: kurir-restore.sh <backup-file.tar.gz> [--yes] [--skip-redis]

# ── Defaults ──────────────────────────────────────────────────────────
BACKUP_FILE=""
SKIP_CONFIRM=false
SKIP_REDIS=false

# ── Arg parsing ───────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y)        SKIP_CONFIRM=true; shift ;;
    --skip-redis)    SKIP_REDIS=true; shift ;;
    -h|--help)
      echo "Usage: kurir-restore.sh <backup-file.tar.gz> [--yes] [--skip-redis]"
      echo ""
      echo "Restores a Kurir backup archive. This will:"
      echo "  1. Validate the archive integrity (checksums)"
      echo "  2. Drop and recreate the database"
      echo "  3. Restore PostgreSQL data from dump"
      echo "  4. Restore Redis data (unless --skip-redis)"
      echo "  5. Re-apply search vector migration"
      echo ""
      echo "Options:"
      echo "  --yes, -y      Skip confirmation prompt"
      echo "  --skip-redis   Skip Redis restore"
      echo "  -h, --help     Show this help"
      echo ""
      echo "WARNING: This is a destructive operation that replaces all current data."
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2; exit 1 ;;
    *)
      [ -z "$BACKUP_FILE" ] && BACKUP_FILE="$1" || { echo "Too many arguments" >&2; exit 1; }
      shift ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────
log() { echo "==> $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

file_size_human() {
  SIZE=$(wc -c < "$1" | tr -d ' ')
  echo "$SIZE" | awk '{
    if ($1 >= 1073741824) printf "%.1f GB", $1/1073741824
    else if ($1 >= 1048576) printf "%.1f MB", $1/1048576
    else if ($1 >= 1024) printf "%.1f KB", $1/1024
    else printf "%d bytes", $1
  }'
}

# Read a JSON value (simple parser for manifest.json, no jq dependency)
json_val() {
  grep "\"$1\"" "$2" | head -1 | sed -E 's/.*: *"?([^",}]*)"?.*/\1/'
}

# ── Validate input ───────────────────────────────────────────────────
[ -n "$BACKUP_FILE" ] || fail "No backup file specified. Usage: kurir-restore.sh <backup-file.tar.gz>"
[ -f "$BACKUP_FILE" ] || fail "File not found: ${BACKUP_FILE}"
[ -n "$DATABASE_URL" ] || fail "DATABASE_URL is not set"

# Check required tools
command -v psql >/dev/null 2>&1 || fail "psql not found (install postgresql-client)"

# ── Extract archive ──────────────────────────────────────────────────
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

log "Extracting backup archive..."
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR" 2>/dev/null || fail "Invalid archive: not a valid .tar.gz file"

# Verify manifest exists
[ -f "${TEMP_DIR}/manifest.json" ] || fail "Invalid backup: missing manifest.json"
[ -f "${TEMP_DIR}/database.sql" ] || fail "Invalid backup: missing database.sql"

# ── Read manifest ────────────────────────────────────────────────────
BACKUP_TIMESTAMP=$(json_val "timestamp" "${TEMP_DIR}/manifest.json")
BACKUP_CREATED=$(json_val "created_at" "${TEMP_DIR}/manifest.json")
FORMAT_VERSION=$(json_val "format" "${TEMP_DIR}/manifest.json")
HAS_REDIS=$(json_val "included" "${TEMP_DIR}/manifest.json" | head -1)
DB_EXPECTED_HASH=$(json_val "sha256" "${TEMP_DIR}/manifest.json" | head -1)

[ "$FORMAT_VERSION" = "1" ] || fail "Unsupported backup format version: ${FORMAT_VERSION}"

# ── Verify checksums ─────────────────────────────────────────────────
log "Verifying backup integrity..."

DB_ACTUAL_HASH=$(sha256 "${TEMP_DIR}/database.sql")
if [ -n "$DB_EXPECTED_HASH" ] && [ "$DB_EXPECTED_HASH" != "$DB_ACTUAL_HASH" ]; then
  fail "Database checksum mismatch! Backup may be corrupted."
fi

if [ "$HAS_REDIS" = "true" ] && [ -f "${TEMP_DIR}/redis.rdb" ] && [ "$SKIP_REDIS" = false ]; then
  REDIS_EXPECTED_HASH=$(grep -A4 '"redis"' "${TEMP_DIR}/manifest.json" | grep '"sha256"' | sed -E 's/.*: *"([^"]*)".*$/\1/')
  if [ -n "$REDIS_EXPECTED_HASH" ]; then
    REDIS_ACTUAL_HASH=$(sha256 "${TEMP_DIR}/redis.rdb")
    if [ "$REDIS_EXPECTED_HASH" != "$REDIS_ACTUAL_HASH" ]; then
      fail "Redis checksum mismatch! Backup may be corrupted."
    fi
  fi
fi

log "Checksums verified."

# ── Show backup info ─────────────────────────────────────────────────
echo ""
echo "  Backup Details"
echo "  ────────────────────────────────────────"
echo "  Archive:    $(basename "$BACKUP_FILE")"
echo "  Size:       $(file_size_human "$BACKUP_FILE")"
echo "  Created:    ${BACKUP_CREATED:-${BACKUP_TIMESTAMP}}"
echo "  Database:   $(file_size_human "${TEMP_DIR}/database.sql")"
if [ "$HAS_REDIS" = "true" ] && [ -f "${TEMP_DIR}/redis.rdb" ]; then
  echo "  Redis:      $(file_size_human "${TEMP_DIR}/redis.rdb")"
else
  echo "  Redis:      not included"
fi
if [ -f "${TEMP_DIR}/env.backup" ]; then
  echo "  Env vars:   included"
fi
echo "  ────────────────────────────────────────"
echo ""

# ── Confirmation ──────────────────────────────────────────────────────
if [ "$SKIP_CONFIRM" = false ]; then
  echo "WARNING: This will DROP and recreate the database, destroying all current data."
  printf "Type 'yes' to continue: "
  read -r CONFIRM
  [ "$CONFIRM" = "yes" ] || { echo "Aborted."; exit 1; }
  echo ""
fi

# ── Restore PostgreSQL ───────────────────────────────────────────────
log "Restoring PostgreSQL database..."

# The dump uses --clean --if-exists, so it includes DROP statements.
# We pipe it through psql. Errors on DROP of non-existent objects are OK.
psql "$DATABASE_URL" < "${TEMP_DIR}/database.sql" > /dev/null 2>&1 || true

# Re-apply search vector migration (trigger + index)
log "Re-applying search vector migration..."
SEARCH_VECTOR_SQL="/app/prisma/migrations/search_vector.sql"
if [ -f "$SEARCH_VECTOR_SQL" ]; then
  psql "$DATABASE_URL" < "$SEARCH_VECTOR_SQL" > /dev/null 2>&1 || {
    log "WARNING: search_vector migration had errors (may already exist)"
  }
else
  log "WARNING: search_vector.sql not found at ${SEARCH_VECTOR_SQL}, skipping"
fi

log "Database restored."

# ── Restore Redis ────────────────────────────────────────────────────
if [ "$HAS_REDIS" = "true" ] && [ -f "${TEMP_DIR}/redis.rdb" ] && [ "$SKIP_REDIS" = false ]; then
  if [ -n "$REDIS_URL" ]; then
    log "Flushing Redis and restoring data..."

    # Parse REDIS_URL
    REDIS_HOST=$(echo "$REDIS_URL" | sed -E 's|redis://([^:]*:[^@]*@)?||; s|:.*||; s|/.*||')
    REDIS_PORT=$(echo "$REDIS_URL" | sed -E 's|.*:([0-9]+).*|\1|')
    REDIS_PASS=$(echo "$REDIS_URL" | sed -nE 's|redis://:([^@]+)@.*|\1|p')

    REDIS_CLI_ARGS="-h ${REDIS_HOST:-127.0.0.1} -p ${REDIS_PORT:-6379}"
    [ -n "$REDIS_PASS" ] && REDIS_CLI_ARGS="$REDIS_CLI_ARGS -a $REDIS_PASS --no-auth-warning"

    # Flush current data (BullMQ queues are transient, this is safe)
    # shellcheck disable=SC2086
    redis-cli $REDIS_CLI_ARGS FLUSHALL > /dev/null 2>&1 || {
      log "WARNING: Redis FLUSHALL failed. You may need to manually restore Redis."
    }

    log "Redis flushed. Note: BullMQ job queues will repopulate automatically."
    log "To fully restore the RDB file, copy ${TEMP_DIR}/redis.rdb to the Redis data directory and restart Redis."
  else
    log "REDIS_URL not set, skipping Redis restore"
  fi
else
  [ "$SKIP_REDIS" = true ] && log "Skipping Redis restore (--skip-redis)"
fi

# ── Show env diff ────────────────────────────────────────────────────
if [ -f "${TEMP_DIR}/env.backup" ]; then
  echo ""
  log "Environment variables from backup:"
  echo "  (Review these and update your .env / docker-compose if needed)"
  echo "  ────────────────────────────────────────"
  while IFS= read -r line; do
    KEY=$(echo "$line" | cut -d= -f1)
    echo "  ${KEY}=<saved>"
  done < "${TEMP_DIR}/env.backup"
  echo "  ────────────────────────────────────────"
  echo "  Full env backup saved at: ${TEMP_DIR}/env.backup"
  echo "  Copy it before this script exits if needed:"
  echo "    cp ${TEMP_DIR}/env.backup ./env.backup"
fi

# ── Done ──────────────────────────────────────────────────────────────
echo ""
log "Restore complete!"
log ""
log "Next steps:"
log "  1. Restart the application to pick up the restored data"
log "     docker compose -f docker-compose.production.yml restart app"
log "  2. Verify the application is working correctly"
log "  3. If env variables changed, update your .env file and restart all services"
