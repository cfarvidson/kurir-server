#!/usr/bin/env bash
# Kurir — One-command installer
# Usage: curl -fsSL https://raw.githubusercontent.com/cfarvidson/kurir-server/main/install.sh | sudo sh
#        curl -fsSL https://raw.githubusercontent.com/cfarvidson/kurir-server/main/install.sh | sudo sh -s -- --mode tailscale
#
# Installs Kurir on a fresh Ubuntu 22.04+ or Debian 12+ server.
# Idempotent — safe to re-run. Existing secrets are preserved.

set -euo pipefail

KURIR_DIR="/opt/kurir"
REQUIRED_DOCKER_VERSION="20"
MODE="public"      # public | tailscale | http
MODE_FROM_FLAG=0   # set to 1 if --mode was passed on the command line

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

prompt_mode() {
    # Skip the prompt entirely if --mode was passed on the command line
    [ "$MODE_FROM_FLAG" -eq 1 ] && return 0

    # Compute a smart default:
    # 1. If an existing .env has MODE set, use that (re-run preserves choice)
    # 2. Else if tailscale CLI is present and the daemon is connected, suggest tailscale
    # 3. Else default to public
    local default_mode="public"
    local detected_reason=""

    if [ -f "$KURIR_DIR/.env" ]; then
        local existing
        existing=$(env_val MODE "$KURIR_DIR/.env")
        if [ -n "${existing:-}" ]; then
            default_mode="$existing"
            detected_reason="existing install"
        fi
    fi

    if [ -z "$detected_reason" ] && command -v tailscale >/dev/null 2>&1; then
        if tailscale status >/dev/null 2>&1; then
            default_mode="tailscale"
            detected_reason="tailscale detected"
        fi
    fi

    local default_num=1
    case "$default_mode" in
        public)    default_num=1 ;;
        tailscale) default_num=2 ;;
        http)      default_num=3 ;;
    esac

    echo ""
    printf '%bSelect install mode:%b\n' "$BOLD" "$NC"
    cat <<'MENUEOF'
  1) public     — Caddy + Let's Encrypt for a publicly-resolvable domain
  2) tailscale  — Tailscale Serve handles TLS for *.ts.net hostnames
  3) http       — HTTP only, for local VM testing (passkeys won't work)
MENUEOF
    if [ -n "$detected_reason" ]; then
        printf '%b(default: %s — %s)%b\n' "$CYAN" "$default_mode" "$detected_reason" "$NC"
    fi
    prompt_default "Mode [1-3 or name]" "$default_num"

    case "$REPLY" in
        1|public)    MODE="public" ;;
        2|tailscale) MODE="tailscale" ;;
        3|http)      MODE="http" ;;
        *)
            fatal "Invalid mode: $REPLY (expected 1/2/3 or public/tailscale/http)"
            ;;
    esac
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

usage() {
    cat <<EOF
Usage: install.sh [--mode public|tailscale|http] [--help]

Modes:
  public      (default) Caddy + Let's Encrypt for a publicly-resolvable domain.
              Use this when you own a domain (e.g. mail.example.com) with an A
              record pointing at this server's public IP.

  tailscale   Skip Caddy. Tailscale Serve terminates TLS for a *.ts.net hostname.
              Use this when the server lives on your tailnet and you don't want
              to expose it to the public internet. Requires the 'tailscale' CLI
              and HTTPS enabled in your tailnet (Admin Console → DNS).

  http        Caddy on port 80 only, no TLS. Use ONLY for local VM testing
              behind another reverse proxy. Passkeys (WebAuthn) require HTTPS,
              so the setup wizard won't fully work in this mode.

Examples:
  sudo ./install.sh
  sudo ./install.sh --mode tailscale
  curl -fsSL https://.../install.sh | sudo sh -s -- --mode tailscale
EOF
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --mode)
                shift
                MODE="${1:-}"
                MODE_FROM_FLAG=1
                ;;
            --mode=*)
                MODE="${1#--mode=}"
                MODE_FROM_FLAG=1
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                error "Unknown argument: $1"
                usage
                exit 2
                ;;
        esac
        shift
    done

    if [ "$MODE_FROM_FLAG" -eq 1 ]; then
        case "$MODE" in
            public|tailscale|http) ;;
            *)
                error "Invalid --mode: $MODE (must be public, tailscale, or http)"
                exit 2
                ;;
        esac
    fi
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
    local ports_to_check=""
    case "$MODE" in
        public)    ports_to_check="80 443" ;;
        http)      ports_to_check="80" ;;
        tailscale) ports_to_check="" ;;  # tailscale serve handles its own ports
    esac

    if [ -z "$ports_to_check" ]; then
        ok "Port check skipped (mode: $MODE)"
        return
    fi

    local blocked=""
    for port in $ports_to_check; do
        if ss -tlnp 2>/dev/null | awk '{print $4}' | grep -qE "(:|^)${port}$"; then
            blocked="${blocked} ${port}"
        fi
    done

    if [ -n "$blocked" ]; then
        # If Caddy is already running from a previous install, that's fine
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "kurir.*proxy"; then
            ok "Port(s)${blocked} in use by existing Kurir proxy (will be restarted)"
        else
            fatal "Port(s)${blocked} already in use. Stop the conflicting service first."
        fi
    else
        ok "Port(s)${ports_to_check:+ }${ports_to_check} are available"
    fi
}

check_tailscale() {
    [ "$MODE" = "tailscale" ] || return 0

    if ! command -v tailscale >/dev/null 2>&1; then
        fatal "Tailscale CLI not found. Install it: https://tailscale.com/download/linux"
    fi

    if ! tailscale status >/dev/null 2>&1; then
        fatal "Tailscale is not connected. Run 'sudo tailscale up' first."
    fi

    ok "Tailscale is connected"
}

# Detect this machine's *.ts.net hostname from `tailscale status --json`
detect_tailscale_hostname() {
    [ "$MODE" = "tailscale" ] || return 0
    command -v tailscale >/dev/null 2>&1 || return 0
    command -v python3 >/dev/null 2>&1 || return 0

    DETECTED_TS_HOSTNAME=$(tailscale status --json 2>/dev/null | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    name = data.get('Self', {}).get('DNSName', '').rstrip('.')
    print(name)
except Exception:
    pass
" 2>/dev/null)
}

# ---------------------------------------------------------------------------
# Secret Generation
# ---------------------------------------------------------------------------

generate_secret() {
    openssl rand -base64 32
}

# URL-safe password (hex only). Use for credentials that go inside connection
# URLs like DATABASE_URL and REDIS_URL — base64 contains '+' and '/' which break
# URL parsing in clients like BullMQ's `new URL(redisUrl)`.
generate_password() {
    openssl rand -hex 32
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
    local vapid_result
    vapid_result=$(python3 -c "
import base64

def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

priv_der = base64.b64decode('$priv_der_b64')
pub_der = base64.b64decode('$pub_der_b64')

# EC private key DER (RFC 5915): version(02 01 01) then OCTET STRING(04 20) with 32-byte scalar
marker = bytes([0x02, 0x01, 0x01, 0x04, 0x20])
idx = priv_der.index(marker) + len(marker)
priv_raw = priv_der[idx:idx+32]

# EC public key DER: last 65 bytes are the uncompressed point (04 + 32x + 32y)
pub_raw = pub_der[-65:]
assert pub_raw[0] == 0x04, 'Expected uncompressed point'

print(b64url(priv_raw))
print(b64url(pub_raw))
") || {
        warn "Failed to extract VAPID keys — skipping"
        return 1
    }

    VAPID_PRIVATE_KEY=$(echo "$vapid_result" | sed -n '1p')
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$(echo "$vapid_result" | sed -n '2p')
    return 0
}

# ---------------------------------------------------------------------------
# User Prompts
# ---------------------------------------------------------------------------

env_val() {
    # Extract value for a key from .env file: env_val KEY file
    # Strips optional surrounding double quotes to prevent accumulation on re-runs
    sed -n "s/^$1=//p" "$2" 2>/dev/null | head -1 | sed 's/^"\(.*\)"$/\1/'
}

prompt_config() {
    # Load existing values if re-running
    if [ -f "$KURIR_DIR/.env" ]; then
        info "Existing installation detected at $KURIR_DIR"
        EXISTING_DOMAIN=$(env_val DOMAIN "$KURIR_DIR/.env")
        EXISTING_EMAIL=$(env_val ACME_EMAIL "$KURIR_DIR/.env")
        EXISTING_MODE=$(env_val MODE "$KURIR_DIR/.env")
        # If user didn't pass --mode and the existing .env has a mode, preserve it
        if [ -n "${EXISTING_MODE:-}" ] && [ "$MODE" = "public" ]; then
            MODE="$EXISTING_MODE"
            info "Using existing mode: $MODE"
        fi
    fi

    # Default domain suggestion depends on mode
    local domain_default="${EXISTING_DOMAIN:-}"
    if [ -z "$domain_default" ] && [ "$MODE" = "tailscale" ]; then
        detect_tailscale_hostname
        domain_default="${DETECTED_TS_HOSTNAME:-}"
    fi

    echo ""
    case "$MODE" in
        public)
            prompt_default "Domain name (e.g. mail.example.com)" "$domain_default"
            ;;
        tailscale)
            prompt_default "Tailscale hostname (e.g. kurir.your-tailnet.ts.net)" "$domain_default"
            ;;
        http)
            prompt_default "Hostname for the install (no TLS will be used)" "${domain_default:-localhost}"
            ;;
    esac
    DOMAIN="$REPLY"
    if [ -z "$DOMAIN" ]; then
        fatal "Hostname is required"
    fi

    if [ "$MODE" = "public" ]; then
        prompt_default "Email for Let's Encrypt certificates" "${EXISTING_EMAIL:-admin@$DOMAIN}"
        ACME_EMAIL="$REPLY"
        if [ -z "$ACME_EMAIL" ]; then
            fatal "Email is required for Let's Encrypt"
        fi
    else
        ACME_EMAIL=""
    fi

    echo ""
    info "Mode:     $MODE"
    info "Hostname: $DOMAIN"
    [ -n "$ACME_EMAIL" ] && info "Email:    $ACME_EMAIL"
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
        _existing_updater_token=$(env_val UPDATER_TOKEN "$KURIR_DIR/.env")
        _existing_vapid_priv=$(env_val VAPID_PRIVATE_KEY "$KURIR_DIR/.env")
        _existing_vapid_pub=$(env_val NEXT_PUBLIC_VAPID_PUBLIC_KEY "$KURIR_DIR/.env")
    fi

    POSTGRES_PASSWORD="${_existing_pg_pass:-$(generate_password)}"
    REDIS_PASSWORD="${_existing_redis_pass:-$(generate_password)}"
    NEXTAUTH_SECRET="${_existing_nextauth:-$(generate_secret)}"
    ENCRYPTION_KEY="${_existing_enc_key:-$(generate_secret)}"
    UPDATER_TOKEN="${_existing_updater_token:-$(generate_password)}"

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

    # Scheme is http only for the http mode; tailscale and public both use https
    local scheme="https"
    [ "$MODE" = "http" ] && scheme="http"
    APP_URL="${scheme}://${DOMAIN}"

    # Write .env atomically with restrictive permissions (never world-readable)
    local tmpenv
    tmpenv=$(mktemp "$KURIR_DIR/.env.XXXXXX")
    chmod 600 "$tmpenv"
    cat > "$tmpenv" <<ENVEOF
# Kurir — generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Re-run the installer to update domain/email. Secrets are preserved.

MODE=$MODE
DOMAIN=$DOMAIN
APP_URL=$APP_URL
ACME_EMAIL=$ACME_EMAIL

POSTGRES_USER=kurir
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=kurir

REDIS_PASSWORD=$REDIS_PASSWORD

NEXTAUTH_SECRET=$NEXTAUTH_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY

# Shared secret between the app and the kurir-updater sidecar. Used to
# authenticate the updater's callback to /api/admin/updates/status and to
# authorize /apply + /rollback calls from the app.
UPDATER_TOKEN=$UPDATER_TOKEN

VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY
NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENVEOF
    mv "$tmpenv" "$KURIR_DIR/.env"
    ok "Wrote $KURIR_DIR/.env (secrets generated)"
}

write_caddyfile() {
    if [ "$MODE" = "tailscale" ]; then
        info "Skipping Caddyfile (tailscale mode — Tailscale Serve handles TLS)"
        return
    fi

    mkdir -p "$KURIR_DIR/config"

    if [ "$MODE" = "http" ]; then
        # HTTP-only Caddy for local testing or when behind another reverse proxy.
        # Note: passkeys (WebAuthn) require HTTPS in browsers; this mode is for
        # smoke-testing the install only.
        cat > "$KURIR_DIR/config/Caddyfile" <<'CADDYEOF'
:80 {
    encode gzip zstd

    handle /_next/static/* {
        header Cache-Control "public, max-age=31536000, immutable"
        reverse_proxy app:3000
    }

    reverse_proxy app:3000

    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }
}
CADDYEOF
    else
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
    fi

    ok "Wrote $KURIR_DIR/config/Caddyfile"
}

write_docker_compose() {
    mkdir -p "$KURIR_DIR"

    # Build the proxy block based on mode
    local proxy_block=""
    local app_ports_block=""

    case "$MODE" in
        public)
            proxy_block='  proxy:
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

'
            ;;
        http)
            proxy_block='  proxy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./config/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      app:
        condition: service_healthy
    deploy:
      resources:
        limits:
          memory: 128m

'
            ;;
        tailscale)
            # No proxy. Tailscale Serve forwards 443 → host:3000 → app container.
            proxy_block=""
            app_ports_block='    ports:
      - "127.0.0.1:3000:3000"
'
            ;;
    esac

    {
        cat <<HEADER
# Kurir — Production Docker Compose (generated by install.sh, mode=$MODE)
# Manage with: cd $KURIR_DIR && docker compose up -d

name: kurir

services:
HEADER

        printf '%s' "$proxy_block"

        cat <<APPEOF
  app:
    image: ghcr.io/cfarvidson/kurir-server:latest
    restart: unless-stopped
${app_ports_block}    environment:
      NODE_ENV: production
      NODE_OPTIONS: --max-old-space-size=768
      DATABASE_URL: postgresql://\${POSTGRES_USER:-kurir}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB:-kurir}?connection_limit=10
      REDIS_URL: redis://:\${REDIS_PASSWORD}@redis:6379
      NEXTAUTH_SECRET: \${NEXTAUTH_SECRET}
      NEXTAUTH_URL: \${APP_URL}
      ENCRYPTION_KEY: \${ENCRYPTION_KEY}
      WEBAUTHN_RP_NAME: Kurir
      WEBAUTHN_RP_ID: \${DOMAIN}
      VAPID_PRIVATE_KEY: \${VAPID_PRIVATE_KEY:-}
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: \${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}
      UPDATER_URL: http://updater:8080
      UPDATER_TOKEN: \${UPDATER_TOKEN}
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
      POSTGRES_USER: \${POSTGRES_USER:-kurir}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: \${POSTGRES_DB:-kurir}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-kurir}"]
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
      --requirepass \${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"\${REDIS_PASSWORD}\" --no-auth-warning ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          memory: 384m

  # Out-of-band updater sidecar. Runs docker compose from outside the app
  # container so restarting the app doesn't kill the update mid-flight.
  updater:
    image: ghcr.io/cfarvidson/kurir-updater:latest
    restart: unless-stopped
    environment:
      APP_URL: http://app:3000
      UPDATER_TOKEN: \${UPDATER_TOKEN}
      WORKDIR: /workdir
      COMPOSE_FILE: docker-compose.yml
      APP_SERVICE: app
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - $KURIR_DIR:/workdir
    deploy:
      resources:
        limits:
          memory: 128m

volumes:
  postgres_data:
  redis_data:
APPEOF

        # Only declare caddy volumes when proxy is present
        if [ -n "$proxy_block" ]; then
            cat <<'VOLEOF'
  caddy_data:
  caddy_config:
VOLEOF
        fi
    } > "$KURIR_DIR/docker-compose.yml"

    ok "Wrote $KURIR_DIR/docker-compose.yml"
}

setup_tailscale_serve() {
    [ "$MODE" = "tailscale" ] || return 0

    info "Configuring Tailscale Serve to forward https://$DOMAIN → app:3000"

    if ! tailscale serve --bg --https=443 http://localhost:3000 >/dev/null 2>&1; then
        warn "Failed to configure Tailscale Serve automatically."
        warn "Run this manually after the install completes:"
        warn "  sudo tailscale serve --bg --https=443 http://localhost:3000"
        warn "Make sure HTTPS is enabled in your tailnet (Admin Console → DNS → Enable HTTPS)."
        return 1
    fi

    ok "Tailscale Serve is forwarding https://$DOMAIN → http://localhost:3000"
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
    info "Mode:       $MODE"
    info "URL:        $APP_URL"
    info "Install:    $KURIR_DIR"
    info ""

    case "$MODE" in
        public)
            info "Open $APP_URL in your browser to complete setup."
            info "The first-run wizard will guide you through creating"
            info "your admin account and connecting your email."
            ;;
        tailscale)
            info "Open $APP_URL from any device on your tailnet."
            info "TLS is terminated by Tailscale Serve. To inspect:"
            info "  sudo tailscale serve status"
            ;;
        http)
            warn "HTTP mode is for local testing only."
            warn "Passkeys (WebAuthn) require HTTPS — the setup wizard"
            warn "will fail at passkey registration in this mode unless"
            warn "you access it via http://localhost from the same machine."
            ;;
    esac
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
    parse_args "$@"
    banner
    check_root
    detect_os
    detect_arch
    check_docker
    prompt_mode
    check_tailscale
    check_ports
    prompt_config
    write_env
    write_caddyfile
    write_docker_compose
    start_services
    setup_tailscale_serve
    print_success
}

# Wrap in main() so partial downloads don't execute
main "$@"
