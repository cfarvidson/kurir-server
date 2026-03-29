#!/bin/bash
set -euo pipefail

# Kurir auto-update script
# Called by the update executor — runs outside the Node process
# so it survives the container restart.

LOG_FILE="/tmp/kurir-update-$(date +%s).log"
APP_URL="${APP_URL:-http://localhost:3000}"
HEALTH_ENDPOINT="$APP_URL/api/up"
MAX_ATTEMPTS=12  # 12 * 5s = 60s
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

log "Starting update..."

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
  echo "PULL_FAILED"
  exit 1
fi

# 3. Restart app (entrypoint handles migrations)
log "Restarting app container..."
docker compose -f "$COMPOSE_FILE" up -d app 2>&1 | tee -a "$LOG_FILE"

# 4. Health check loop
log "Waiting for health check..."
sleep 5  # Give container time to start

for i in $(seq 1 $MAX_ATTEMPTS); do
  if curl -sf "$HEALTH_ENDPOINT" > /dev/null 2>&1; then
    log "Health check passed on attempt $i"
    echo "UPDATE_SUCCESS"
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

echo "UPDATE_ROLLED_BACK"
exit 1
