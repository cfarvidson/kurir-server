#!/usr/bin/env bash
# Kurir — One-command installer
# Usage: curl -fsSL https://raw.githubusercontent.com/cfarvidson/kurir-server/main/install.sh | bash
#
# Installs Kurir on a fresh Ubuntu 22.04+ or Debian 12+ server.
# Idempotent — safe to re-run. Existing secrets are preserved.

set -euo pipefail

KURIR_DIR="/opt/kurir"
REQUIRED_DOCKER_VERSION="20"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { printf '%b[INFO]%b  %s\n' "$CYAN" "$NC" "$*"; }
ok()    { printf '%b[OK]%b    %s\n' "$GREEN" "$NC" "$*"; }
warn()  { printf '%b[WARN]%b  %s\n' "$YELLOW" "$NC" "$*"; }
error() { printf '%b[ERROR]%b %s\n' "$RED" "$NC" "$*" >&2; }
fatal() { error "$@"; exit 1; }

prompt_default() {
    local msg="$1" default="$2"
    printf '%b%s [%s]:%b ' "$BOLD" "$msg" "$default" "$NC"
    if [ -t 0 ]; then
        read -r REPLY
    else
        read -r REPLY </dev/tty
    fi
    REPLY="${REPLY:-$default}"
}

banner() {
    printf '%b%b' "$CYAN" "$BOLD"
    cat <<'EOF'

  _  __          _
 | |/ /  _ _ _ _(_)_ _
 | ' < || | '_| | '_|
 |_|\_\_,_|_| |_|_|

 One-command installer

EOF
    printf '%b' "$NC"
}

# ---------------------------------------------------------------------------
# Detection & Validation
# ---------------------------------------------------------------------------

detect_os() {
    if [ ! -f /etc/os-release ]; then
        fatal "Cannot detect OS: /etc/os-release not found"
    fi

    # shellcheck source=/dev/null
    . /etc/os-release

    OS_ID="${ID:-unknown}"
    OS_VERSION="${VERSION_ID:-0}"

    case "$OS_ID" in
        ubuntu)
            if [ "$(echo "$OS_VERSION" | cut -d. -f1)" -lt 22 ]; then
                fatal "Ubuntu 22.04 or later required (found $OS_VERSION)"
            fi
            ;;
        debian)
            if [ "$OS_VERSION" -lt 12 ]; then
                fatal "Debian 12 or later required (found $OS_VERSION)"
            fi
            ;;
        *)
            warn "Untested OS: $OS_ID $OS_VERSION (targeting Ubuntu 22.04+ / Debian 12+)"
            ;;
    esac

    ok "OS: $OS_ID $OS_VERSION"
}

detect_arch() {
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64)  ARCH_LABEL="amd64" ;;
        aarch64) ARCH_LABEL="arm64" ;;
        arm64)   ARCH_LABEL="arm64" ;;  # macOS reports arm64
        *)       fatal "Unsupported architecture: $ARCH" ;;
    esac
    ok "Architecture: $ARCH_LABEL"
}

check_root() {
    if [ "$(id -u)" -ne 0 ]; then
        fatal "This installer must be run as root (try: sudo sh or curl ... | sudo sh)"
    fi
}

check_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        fatal "Docker is not installed. Install it first: https://docs.docker.com/engine/install/"
    fi

    if ! docker info >/dev/null 2>&1; then
        fatal "Docker daemon is not running. Start it with: systemctl start docker"
    fi

    DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null | cut -d. -f1)
    if [ "${DOCKER_VERSION:-0}" -lt "$REQUIRED_DOCKER_VERSION" ]; then
        fatal "Docker $REQUIRED_DOCKER_VERSION+ required (found ${DOCKER_VERSION:-unknown})"
    fi

    # Check for docker compose (v2 plugin)
    if docker compose version >/dev/null 2>&1; then
        ok "Docker $(docker version --format '{{.Server.Version}}') with Compose plugin"
    else
        fatal "Docker Compose plugin not found. Install it: https://docs.docker.com/compose/install/"
    fi
}

check_ports() {
    local blocked=""
    for port in 80 443; do
        if ss -tlnp 2>/dev/null | grep -q ":${port} " || \
           netstat -tlnp 2>/dev/null | grep -q ":${port} "; then
            blocked="${blocked} ${port}"
        fi
    done

    if [ -n "$blocked" ]; then
        # If Caddy is already running from a previous install, that's fine
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "kurir.*proxy"; then
            ok "Ports 80/443 in use by existing Kurir proxy (will be restarted)"
        else
            fatal "Port(s)${blocked} already in use. Stop the conflicting service first."
        fi
    else
        ok "Ports 80 and 443 are available"
    fi
}

# ---------------------------------------------------------------------------
# Secret Generation
# ---------------------------------------------------------------------------

generate_secret() {
    openssl rand -base64 32
}

generate_vapid_keys() {
    # Generate ECDSA P-256 key pair and extract raw bytes for web-push VAPID format
    if ! command -v openssl >/dev/null 2>&1; then
        warn "openssl not found — skipping VAPID key generation"
        return 1
    fi

    if ! command -v python3 >/dev/null 2>&1; then
        warn "python3 not found — skipping VAPID key generation"
        return 1
    fi

    local tmpkey
    tmpkey=$(mktemp)

    openssl ecparam -genkey -name prime256v1 -noout -out "$tmpkey" 2>/dev/null || {
        rm -f "$tmpkey"
        warn "Failed to generate EC key pair — skipping VAPID"
        return 1
    }

    # Get DER-encoded private and public keys
    local priv_der_b64 pub_der_b64
    priv_der_b64=$(openssl ec -in "$tmpkey" -outform DER 2>/dev/null | base64 | tr -d '\n')
    pub_der_b64=$(openssl ec -in "$tmpkey" -pubout -outform DER 2>/dev/null | base64 | tr -d '\n')
    rm -f "$tmpkey"

    # Extract raw key bytes from DER and convert to URL-safe base64
    eval "$(python3 -c "
import base64, sys

def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

priv_der = base64.b64decode('$priv_der_b64')
pub_der = base64.b64decode('$pub_der_b64')

# EC private key DER: version(02 01 01) then OCTET STRING(04 20) containing 32-byte scalar
marker = bytes([0x02, 0x01, 0x01, 0x04, 0x20])
idx = priv_der.index(marker) + len(marker)
priv_raw = priv_der[idx:idx+32]

# EC public key DER: last 65 bytes are the uncompressed point (04 + 32x + 32y)
pub_raw = pub_der[-65:]
assert pub_raw[0] == 0x04, 'Expected uncompressed point'

print(f'VAPID_PRIVATE_KEY=\"{b64url(priv_raw)}\"')
print(f'NEXT_PUBLIC_VAPID_PUBLIC_KEY=\"{b64url(pub_raw)}\"')
")" || {
        warn "Failed to extract VAPID keys — skipping"
        return 1
    }

    return 0
}

# ---------------------------------------------------------------------------
# User Prompts
# ---------------------------------------------------------------------------

env_val() {
    # Extract value for a key from .env file: env_val KEY file
    sed -n "s/^$1=//p" "$2" 2>/dev/null | head -1
}

prompt_config() {
    # Load existing values if re-running
    if [ -f "$KURIR_DIR/.env" ]; then
        info "Existing installation detected at $KURIR_DIR"
        EXISTING_DOMAIN=$(env_val DOMAIN "$KURIR_DIR/.env")
        EXISTING_EMAIL=$(env_val ACME_EMAIL "$KURIR_DIR/.env")
    fi

    echo ""
    prompt_default "Domain name (e.g. mail.example.com)" "${EXISTING_DOMAIN:-}"
    DOMAIN="$REPLY"
    if [ -z "$DOMAIN" ]; then
        fatal "Domain name is required"
    fi

    prompt_default "Email for Let's Encrypt certificates" "${EXISTING_EMAIL:-admin@$DOMAIN}"
    ACME_EMAIL="$REPLY"
    if [ -z "$ACME_EMAIL" ]; then
        fatal "Email is required for Let's Encrypt"
    fi

    echo ""
    info "Domain:  $DOMAIN"
    info "Email:   $ACME_EMAIL"
    echo ""
}

# ---------------------------------------------------------------------------
# File Writers
# ---------------------------------------------------------------------------

write_env() {
    mkdir -p "$KURIR_DIR"

    # Preserve existing secrets on re-run
    if [ -f "$KURIR_DIR/.env" ]; then
        info "Preserving existing secrets from .env"
        _existing_pg_pass=$(env_val POSTGRES_PASSWORD "$KURIR_DIR/.env")
        _existing_redis_pass=$(env_val REDIS_PASSWORD "$KURIR_DIR/.env")
        _existing_nextauth=$(env_val NEXTAUTH_SECRET "$KURIR_DIR/.env")
        _existing_enc_key=$(env_val ENCRYPTION_KEY "$KURIR_DIR/.env")
        _existing_vapid_priv=$(env_val VAPID_PRIVATE_KEY "$KURIR_DIR/.env")
        _existing_vapid_pub=$(env_val NEXT_PUBLIC_VAPID_PUBLIC_KEY "$KURIR_DIR/.env")
    fi

    POSTGRES_PASSWORD="${_existing_pg_pass:-$(generate_secret)}"
    REDIS_PASSWORD="${_existing_redis_pass:-$(generate_secret)}"
    NEXTAUTH_SECRET="${_existing_nextauth:-$(generate_secret)}"
    ENCRYPTION_KEY="${_existing_enc_key:-$(generate_secret)}"

    # Generate VAPID keys if not preserved from existing install
    if [ -n "${_existing_vapid_priv:-}" ] && [ -n "${_existing_vapid_pub:-}" ]; then
        VAPID_PRIVATE_KEY="$_existing_vapid_priv"
        NEXT_PUBLIC_VAPID_PUBLIC_KEY="$_existing_vapid_pub"
    else
        VAPID_PRIVATE_KEY=""
        NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
        if generate_vapid_keys; then
            ok "Generated VAPID keys for push notifications"
        else
            warn "Push notifications disabled (VAPID keys not generated)"
        fi
    fi

    cat > "$KURIR_DIR/.env" <<ENVEOF
# Kurir — generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Re-run the installer to update domain/email. Secrets are preserved.

DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL

POSTGRES_USER=kurir
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=kurir

REDIS_PASSWORD=$REDIS_PASSWORD

NEXTAUTH_SECRET=$NEXTAUTH_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY

VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY
NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENVEOF

    chmod 600 "$KURIR_DIR/.env"
    ok "Wrote $KURIR_DIR/.env (secrets generated)"
}

write_caddyfile() {
    mkdir -p "$KURIR_DIR/config"

    cat > "$KURIR_DIR/config/Caddyfile" <<'CADDYEOF'
{$DOMAIN} {
    encode gzip zstd

    handle /_next/static/* {
        header Cache-Control "public, max-age=31536000, immutable"
        reverse_proxy app:3000
    }

    reverse_proxy app:3000

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }

    tls {$ACME_EMAIL}
}
CADDYEOF

    ok "Wrote $KURIR_DIR/config/Caddyfile"
}

write_docker_compose() {
    cat > "$KURIR_DIR/docker-compose.yml" <<'COMPOSEEOF'
# Kurir — Production Docker Compose (generated by install.sh)
# Manage with: cd /opt/kurir && docker compose up -d

services:
  proxy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./config/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    environment:
      DOMAIN: ${DOMAIN}
      ACME_EMAIL: ${ACME_EMAIL}
    depends_on:
      app:
        condition: service_healthy
    deploy:
      resources:
        limits:
          memory: 128m

  app:
    image: ghcr.io/cfarvidson/kurir-server:latest
    restart: unless-stopped
    environment:
      NODE_ENV: production
      NODE_OPTIONS: --max-old-space-size=768
      DATABASE_URL: postgresql://${POSTGRES_USER:-kurir}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-kurir}?connection_limit=10
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
      NEXTAUTH_URL: https://${DOMAIN}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      WEBAUTHN_RP_NAME: Kurir
      WEBAUTHN_RP_ID: ${DOMAIN}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:-}
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: ${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/api/up"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 40s
    deploy:
      resources:
        limits:
          memory: 1024m

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    shm_size: 256m
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-kurir}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB:-kurir}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-kurir}"]
      interval: 5s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          memory: 512m

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: >-
      redis-server
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
      --appendonly yes
      --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"${REDIS_PASSWORD}\" --no-auth-warning ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          memory: 384m

volumes:
  postgres_data:
  redis_data:
  caddy_data:
  caddy_config:
COMPOSEEOF

    ok "Wrote $KURIR_DIR/docker-compose.yml"
}

# ---------------------------------------------------------------------------
# Service Management
# ---------------------------------------------------------------------------

start_services() {
    cd "$KURIR_DIR"

    info "Pulling container images (this may take a few minutes)..."
    docker compose pull --quiet

    info "Starting services..."
    docker compose up -d

    info "Waiting for the app to become healthy..."
    local attempts=0
    local max_attempts=60
    while [ $attempts -lt $max_attempts ]; do
        if docker compose ps app --format '{{.Health}}' 2>/dev/null | grep -q "healthy"; then
            ok "All services are running"
            return 0
        fi
        attempts=$((attempts + 1))
        sleep 5
    done

    warn "App did not become healthy within 5 minutes"
    info "Check logs with: cd $KURIR_DIR && docker compose logs app"
    return 1
}

# ---------------------------------------------------------------------------
# Success
# ---------------------------------------------------------------------------

print_success() {
    printf '\n%b%b' "$GREEN" "$BOLD"
    cat <<'EOF'
  ============================================
           Kurir is up and running!
  ============================================
EOF
    printf '%b\n' "$NC"
    info "URL:        https://$DOMAIN"
    info "Install:    $KURIR_DIR"
    info ""
    info "Open https://$DOMAIN in your browser to complete setup."
    info "The first-run wizard will guide you through creating"
    info "your admin account and connecting your email."
    info ""
    info "Useful commands:"
    info "  cd $KURIR_DIR"
    info "  docker compose logs -f          # Tail all logs"
    info "  docker compose logs app -f      # App logs only"
    info "  docker compose restart app      # Restart the app"
    info "  docker compose pull && docker compose up -d  # Update"
    info ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    banner
    check_root
    detect_os
    detect_arch
    check_docker
    check_ports
    prompt_config
    write_env
    write_caddyfile
    write_docker_compose
    start_services
    print_success
}

# Wrap in main() so partial downloads don't execute
main "$@"
