#!/bin/sh
set -e

# Kurir Backup — dumps PostgreSQL + Redis + env into a timestamped .tar.gz
# Usage: kurir-backup.sh [--output-dir DIR] [--no-redis] [--no-env] [--quiet]

# ── Defaults ──────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/app/backups}"
INCLUDE_REDIS=true
INCLUDE_ENV=true
QUIET=false
TIMESTAMP=$(date -u +%Y-%m-%d-%H%M%S)
BACKUP_NAME="kurir-backup-${TIMESTAMP}"

# ── Arg parsing ───────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --output-dir) BACKUP_DIR="$2"; shift 2 ;;
    --no-redis)   INCLUDE_REDIS=false; shift ;;
    --no-env)     INCLUDE_ENV=false; shift ;;
    --quiet)      QUIET=true; shift ;;
    -h|--help)
      echo "Usage: kurir-backup.sh [--output-dir DIR] [--no-redis] [--no-env] [--quiet]"
      echo ""
      echo "Creates a timestamped backup archive containing:"
      echo "  - PostgreSQL database dump (database.sql)"
      echo "  - Redis RDB snapshot (redis.rdb)        [unless --no-redis]"
      echo "  - Environment variables (env.backup)     [unless --no-env]"
      echo ""
      echo "Options:"
      echo "  --output-dir DIR  Output directory (default: /app/backups or \$BACKUP_DIR)"
      echo "  --no-redis        Skip Redis backup"
      echo "  --no-env          Skip environment variable backup"
      echo "  --quiet           Suppress progress messages"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────
log() { [ "$QUIET" = true ] || echo "==> $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

sha256() {
  # Works on both Alpine (sha256sum) and macOS (shasum)
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

file_size() {
  wc -c < "$1" | tr -d ' '
}

# ── Validate environment ─────────────────────────────────────────────
[ -n "$DATABASE_URL" ] || fail "DATABASE_URL is not set"

if [ "$INCLUDE_REDIS" = true ] && [ -z "$REDIS_URL" ]; then
  log "REDIS_URL not set, skipping Redis backup"
  INCLUDE_REDIS=false
fi

# Check required tools
command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found (install postgresql-client)"
if [ "$INCLUDE_REDIS" = true ]; then
  command -v redis-cli >/dev/null 2>&1 || fail "redis-cli not found (install redis)"
fi

# ── Setup ─────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

log "Starting Kurir backup..."
log "Timestamp: ${TIMESTAMP}"

# ── 1. PostgreSQL dump ────────────────────────────────────────────────
log "Dumping PostgreSQL database..."
pg_dump \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  "$DATABASE_URL" > "${TEMP_DIR}/database.sql"

DB_SIZE=$(file_size "${TEMP_DIR}/database.sql")
DB_HASH=$(sha256 "${TEMP_DIR}/database.sql")
log "Database dump: $(echo "$DB_SIZE" | awk '{printf "%.1f MB", $1/1048576}') "

# ── 2. Redis snapshot ────────────────────────────────────────────────
REDIS_SIZE=0
REDIS_HASH=""
if [ "$INCLUDE_REDIS" = true ]; then
  log "Dumping Redis data..."

  # Parse REDIS_URL: redis://:password@host:port or redis://host:port
  REDIS_HOST=$(echo "$REDIS_URL" | sed -E 's|redis://([^:]*:[^@]*@)?||; s|:.*||; s|/.*||')
  REDIS_PORT=$(echo "$REDIS_URL" | sed -E 's|.*:([0-9]+).*|\1|')
  REDIS_PASS=$(echo "$REDIS_URL" | sed -nE 's|redis://:([^@]+)@.*|\1|p')

  REDIS_CLI_ARGS="-h ${REDIS_HOST:-127.0.0.1} -p ${REDIS_PORT:-6379}"
  [ -n "$REDIS_PASS" ] && REDIS_CLI_ARGS="$REDIS_CLI_ARGS -a $REDIS_PASS --no-auth-warning"

  # shellcheck disable=SC2086
  redis-cli $REDIS_CLI_ARGS --rdb "${TEMP_DIR}/redis.rdb" >/dev/null 2>&1 || {
    log "WARNING: Redis RDB dump failed, skipping Redis backup"
    INCLUDE_REDIS=false
  }

  if [ "$INCLUDE_REDIS" = true ]; then
    REDIS_SIZE=$(file_size "${TEMP_DIR}/redis.rdb")
    REDIS_HASH=$(sha256 "${TEMP_DIR}/redis.rdb")
    log "Redis snapshot: $(echo "$REDIS_SIZE" | awk '{printf "%.1f MB", $1/1048576}')"
  fi
fi

# ── 3. Environment variables ─────────────────────────────────────────
ENV_SIZE=0
ENV_HASH=""
if [ "$INCLUDE_ENV" = true ]; then
  log "Saving environment variables..."
  env | grep -E '^(DATABASE_URL|REDIS_URL|NEXTAUTH_SECRET|NEXTAUTH_URL|ENCRYPTION_KEY|WEBAUTHN_RP_NAME|WEBAUTHN_RP_ID|DOMAIN|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PASSWORD|VAPID_PRIVATE_KEY|NEXT_PUBLIC_VAPID_PUBLIC_KEY|MICROSOFT_CLIENT_ID|MICROSOFT_CLIENT_SECRET|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET)=' \
    | sort > "${TEMP_DIR}/env.backup" 2>/dev/null || true

  if [ -s "${TEMP_DIR}/env.backup" ]; then
    ENV_SIZE=$(file_size "${TEMP_DIR}/env.backup")
    ENV_HASH=$(sha256 "${TEMP_DIR}/env.backup")
  else
    INCLUDE_ENV=false
  fi
fi

# ── 4. Write manifest ────────────────────────────────────────────────
log "Writing manifest..."
cat > "${TEMP_DIR}/manifest.json" << MANIFEST_EOF
{
  "format": 1,
  "tool": "kurir-backup",
  "timestamp": "${TIMESTAMP}",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "contents": {
    "database": {
      "file": "database.sql",
      "size": ${DB_SIZE},
      "sha256": "${DB_HASH}"
    },
    "redis": {
      "included": ${INCLUDE_REDIS},
      "file": "redis.rdb",
      "size": ${REDIS_SIZE},
      "sha256": "${REDIS_HASH}"
    },
    "env": {
      "included": ${INCLUDE_ENV},
      "file": "env.backup",
      "size": ${ENV_SIZE},
      "sha256": "${ENV_HASH}"
    }
  }
}
MANIFEST_EOF

# ── 5. Create archive ────────────────────────────────────────────────
log "Creating archive..."
ARCHIVE_PATH="${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"

# Build file list (only include files that exist)
FILES="manifest.json database.sql"
[ "$INCLUDE_REDIS" = true ] && FILES="$FILES redis.rdb"
[ "$INCLUDE_ENV" = true ] && FILES="$FILES env.backup"

# shellcheck disable=SC2086
tar -czf "$ARCHIVE_PATH" -C "$TEMP_DIR" $FILES

ARCHIVE_SIZE=$(file_size "$ARCHIVE_PATH")

# ── Done ──────────────────────────────────────────────────────────────
log ""
log "Backup complete!"
log "  Archive: ${ARCHIVE_PATH}"
log "  Size:    $(echo "$ARCHIVE_SIZE" | awk '{printf "%.1f MB", $1/1048576}')"
log "  Contents:"
log "    - PostgreSQL database ($(echo "$DB_SIZE" | awk '{printf "%.1f MB", $1/1048576}'))"
[ "$INCLUDE_REDIS" = true ] && log "    - Redis snapshot ($(echo "$REDIS_SIZE" | awk '{printf "%.1f MB", $1/1048576}'))"
[ "$INCLUDE_ENV" = true ] && log "    - Environment variables"

echo "$ARCHIVE_PATH"
