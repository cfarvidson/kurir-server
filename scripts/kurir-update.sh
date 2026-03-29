#!/bin/bash
set -euo pipefail

# Kurir auto-update script
# Called by the update executor — runs outside the Node process
# so it survives the container restart.

LOG_FILE="/tmp/kurir-update-$(date +%s).log"
APP_URL="${APP_URL:-http://localhost:3000}"
HEALTH_ENDPOINT="$APP_URL/api/up"
STATUS_ENDPOINT="$APP_URL/api/admin/updates/status"
MAX_ATTEMPTS=12  # 12 * 5s = 60s
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
UPDATE_LOG_ID="${UPDATE_LOG_ID:-}"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

report_status() {
  local status="$1"
  local error="${2:-}"
  if [ -n "$UPDATE_LOG_ID" ]; then
    curl -sf -X POST "$STATUS_ENDPOINT" \
      -H "Content-Type: application/json" \
      -d "{\"logId\":\"$UPDATE_LOG_ID\",\"status\":\"$status\",\"error\":$([ -n "$error" ] && echo "\"$error\"" || echo "null")}" \
      > /dev/null 2>&1 || log "Warning: could not report status"
  fi
}

log "Starting update..."
report_status "pulling"

# 1. Tag current image for rollback
CURRENT_IMAGE=$(docker compose -f "$COMPOSE_FILE" images app --format json 2>/dev/null | python3 -c "import sys,json; imgs=json.load(sys.stdin); print(imgs[0]['Repository']+':'+imgs[0]['Tag'])" 2>/dev/null || echo "")
if [ -n "$CURRENT_IMAGE" ] && [ "$CURRENT_IMAGE" != ":" ]; then
  log "Tagging current image for rollback: $CURRENT_IMAGE"
  docker tag "$CURRENT_IMAGE" kurir-server:rollback 2>/dev/null || log "Warning: could not tag rollback image"
else
  log "Warning: could not determine current image for rollback"
fi

# 2. Pull new image
log "Pulling new image..."
if ! docker compose -f "$COMPOSE_FILE" pull app 2>&1 | tee -a "$LOG_FILE"; then
  log "ERROR: docker compose pull failed"
  report_status "failed" "docker compose pull failed"
  exit 1
fi

# 3. Restart app (entrypoint handles migrations)
log "Restarting app container..."
report_status "restarting"
docker compose -f "$COMPOSE_FILE" up -d app 2>&1 | tee -a "$LOG_FILE"

# 4. Health check loop
log "Waiting for health check..."
report_status "verifying"
sleep 5  # Give container time to start

for i in $(seq 1 $MAX_ATTEMPTS); do
  if curl -sf "$HEALTH_ENDPOINT" > /dev/null 2>&1; then
    log "Health check passed on attempt $i"
    report_status "success"
    exit 0
  fi
  log "Health check attempt $i/$MAX_ATTEMPTS failed, retrying in 5s..."
  sleep 5
done

# 5. Health check failed — rollback
log "Health check failed after $MAX_ATTEMPTS attempts, rolling back..."
if [ -n "$CURRENT_IMAGE" ] && [ "$CURRENT_IMAGE" != ":" ]; then
  docker tag kurir-server:rollback "$CURRENT_IMAGE" 2>/dev/null || true
  docker compose -f "$COMPOSE_FILE" up -d app 2>&1 | tee -a "$LOG_FILE"
  log "Rollback complete"
fi

report_status "rolled_back" "Health check failed after ${MAX_ATTEMPTS} attempts"
exit 1
