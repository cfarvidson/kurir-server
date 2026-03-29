#!/bin/sh
set -e
umask 077

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
      echo "  4. Flush Redis cache (unless --skip-redis)"
      echo "  5. Re-apply search vector migration"
      echo ""
      echo "Options:"
      echo "  --yes, -y      Skip confirmation prompt"
      echo "  --skip-redis   Skip Redis flush"
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
  wc -c < "$1" | tr -d ' ' | awk '{printf "%.1f MB", $1/1048576}'
}

# Read a value from the flat manifest.json (unique top-level keys, no nesting)
json_val() {
  grep "\"$1\"" "$2" | sed -E 's/^[^:]*: *"?([^",}]*)"?.*/\1/'
}

# Strip Prisma-specific query params from DATABASE_URL
db_url_clean() {
  echo "$DATABASE_URL" | sed 's/?.*//'
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

# ── Read manifest (flat keys — no ambiguity) ─────────────────────────
BACKUP_TIMESTAMP=$(json_val "timestamp" "${TEMP_DIR}/manifest.json")
BACKUP_CREATED=$(json_val "created_at" "${TEMP_DIR}/manifest.json")
FORMAT_VERSION=$(json_val "format" "${TEMP_DIR}/manifest.json")
HAS_REDIS=$(json_val "redis_included" "${TEMP_DIR}/manifest.json")
DB_EXPECTED_HASH=$(json_val "db_sha256" "${TEMP_DIR}/manifest.json")
HAS_ENV=$(json_val "env_included" "${TEMP_DIR}/manifest.json")

[ "$FORMAT_VERSION" = "1" ] || fail "Unsupported backup format version: ${FORMAT_VERSION}"

# ── Verify checksums ─────────────────────────────────────────────────
log "Verifying backup integrity..."

DB_ACTUAL_HASH=$(sha256 "${TEMP_DIR}/database.sql")
if [ -n "$DB_EXPECTED_HASH" ] && [ "$DB_EXPECTED_HASH" != "$DB_ACTUAL_HASH" ]; then
  fail "Database checksum mismatch! Backup may be corrupted."
fi

if [ "$HAS_REDIS" = "true" ] && [ -f "${TEMP_DIR}/redis.rdb" ] && [ "$SKIP_REDIS" = false ]; then
  REDIS_EXPECTED_HASH=$(json_val "redis_sha256" "${TEMP_DIR}/manifest.json")
  if [ -n "$REDIS_EXPECTED_HASH" ]; then
    REDIS_ACTUAL_HASH=$(sha256 "${TEMP_DIR}/redis.rdb")
    if [ "$REDIS_EXPECTED_HASH" != "$REDIS_ACTUAL_HASH" ]; then
      fail "Redis checksum mismatch! Backup may be corrupted."
    fi
  fi
fi

if [ "$HAS_ENV" = "true" ] && [ -f "${TEMP_DIR}/env.backup" ]; then
  ENV_EXPECTED_HASH=$(json_val "env_sha256" "${TEMP_DIR}/manifest.json")
  if [ -n "$ENV_EXPECTED_HASH" ]; then
    ENV_ACTUAL_HASH=$(sha256 "${TEMP_DIR}/env.backup")
    if [ "$ENV_EXPECTED_HASH" != "$ENV_ACTUAL_HASH" ]; then
      fail "Env backup checksum mismatch! Backup may be corrupted."
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

# The dump uses --clean --if-exists, so it includes DROP IF EXISTS statements.
# Capture stderr to detect genuine failures (not just "does not exist" notices).
DB_URL_CLEAN=$(db_url_clean)
RESTORE_ERRORS=$(psql "$DB_URL_CLEAN" < "${TEMP_DIR}/database.sql" 2>&1 >/dev/null) || true

# Check for fatal errors (ignore expected "does not exist" drops)
FATAL_ERRORS=$(echo "$RESTORE_ERRORS" | grep -iE "^(FATAL|ERROR)" | grep -iv "does not exist" || true)
if [ -n "$FATAL_ERRORS" ]; then
  echo "$FATAL_ERRORS" >&2
  fail "Database restore encountered errors (see above)"
fi

# Re-apply search vector migration (trigger + index)
log "Re-applying search vector migration..."
SEARCH_VECTOR_SQL="/app/prisma/migrations/search_vector.sql"
if [ -f "$SEARCH_VECTOR_SQL" ]; then
  psql "$DB_URL_CLEAN" < "$SEARCH_VECTOR_SQL" > /dev/null 2>&1 || {
    log "WARNING: search_vector migration had errors (may already exist)"
  }
else
  log "WARNING: search_vector.sql not found at ${SEARCH_VECTOR_SQL}, skipping"
fi

log "Database restored."

# ── Flush Redis cache ────────────────────────────────────────────────
# Note: The RDB snapshot in the backup is for disaster recovery reference only.
# redis-cli cannot load an RDB file into a running server — that requires stopping
# Redis, replacing the dump file on disk, and restarting. BullMQ queues and caches
# repopulate automatically, so a FLUSHALL is sufficient for most restore scenarios.
if [ "$HAS_REDIS" = "true" ] && [ "$SKIP_REDIS" = false ]; then
  if [ -n "$REDIS_URL" ] && command -v redis-cli >/dev/null 2>&1; then
    log "Flushing Redis cache (BullMQ queues will repopulate automatically)..."

    redis-cli -u "$REDIS_URL" --no-auth-warning FLUSHALL > /dev/null 2>&1 || {
      log "WARNING: Redis FLUSHALL failed. You may need to flush Redis manually."
    }

    log "Redis flushed."
    if [ -f "${TEMP_DIR}/redis.rdb" ]; then
      log "RDB snapshot available in backup for manual disaster recovery."
      log "To fully restore: stop Redis, copy redis.rdb to its data dir, restart Redis."
    fi
  else
    log "REDIS_URL not set or redis-cli unavailable, skipping Redis flush"
  fi
else
  [ "$SKIP_REDIS" = true ] && log "Skipping Redis flush (--skip-redis)"
fi

# ── Show env diff ────────────────────────────────────────────────────
if [ -f "${TEMP_DIR}/env.backup" ]; then
  # Copy env.backup to a persistent location before the EXIT trap fires
  ENV_RESTORE_PATH="${BACKUP_DIR:-/app/backups}/env.backup.restored"
  cp "${TEMP_DIR}/env.backup" "$ENV_RESTORE_PATH" 2>/dev/null || ENV_RESTORE_PATH=""

  echo ""
  log "Environment variables from backup:"
  echo "  (Review these and update your .env / docker-compose if needed)"
  echo "  ────────────────────────────────────────"
  while IFS= read -r line; do
    KEY=$(echo "$line" | cut -d= -f1)
    echo "  ${KEY}=<saved>"
  done < "${TEMP_DIR}/env.backup"
  echo "  ────────────────────────────────────────"
  if [ -n "$ENV_RESTORE_PATH" ]; then
    echo "  Saved to: ${ENV_RESTORE_PATH}"
  fi
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
