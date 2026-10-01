#!/usr/bin/env bash
# Kurir Watch — One-command installer
# Usage: curl -fsSL https://raw.githubusercontent.com/cfarvidson/kurir-server/main/install-watch.sh | sudo bash
#
# Kurir Watch is the always-on device for Kurir 2.0: it keeps IMAP IDLE open on
# your mailbox, judges AI rules, delivers scheduled sends and pushes your phones.
# It needs no server and no database — just your mail account.
#
# Installs on a fresh Ubuntu 22.04+ or Debian 12+ box with Docker, into
# /opt/kurir-watch: a docker-compose.yml, config.toml (account, no secrets) and
# .env (password and AI token, mode 0600). A daily systemd timer pulls the
# newest image. Idempotent — re-running keeps config and secrets; pass
# --reconfigure to be asked again.
#
# Every prompt can be answered up front with an environment variable
# (KURIR_WATCH_EMAIL, KURIR_WATCH_USERNAME, KURIR_WATCH_PASSWORD,
# KURIR_WATCH_IMAP_HOST, KURIR_WATCH_IMAP_PORT, KURIR_WATCH_SMTP_HOST,
# KURIR_WATCH_SMTP_PORT, KURIR_WATCH_DISPLAY_NAME, KURIR_WATCH_SEND_AS,
# KURIR_WATCH_RELAY_URL, KURIR_WATCH_INFERENCE_PROVIDER,
# KURIR_WATCH_INFERENCE_TOKEN, KURIR_WATCH_INFERENCE_MODEL); set
# KURIR_WATCH_NONINTERACTIVE=1 to take every default without asking.

set -euo pipefail

KURIR_DIR="/opt/kurir-watch"
IMAGE="${KURIR_WATCH_IMAGE:-ghcr.io/cfarvidson/kurir-watch:latest}"
REQUIRED_DOCKER_VERSION="20"
RECONFIGURE=0

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

# prompt_default MSG DEFAULT [ENV_NAME]: the environment variable wins, then
# the terminal, then the default. Reads /dev/tty when stdin is the curl pipe.
prompt_default() {
    local msg="$1" default="$2" env_name="${3:-}"
    if [ -n "$env_name" ] && [ -n "${!env_name:-}" ]; then
        REPLY="${!env_name}"
        return
    fi
    if [ "${KURIR_WATCH_NONINTERACTIVE:-0}" = "1" ]; then
        REPLY="$default"
        return
    fi
    printf '%b%s [%s]:%b ' "$BOLD" "$msg" "$default" "$NC"
    if [ -t 0 ]; then
        read -r REPLY
    else
        read -r REPLY </dev/tty
    fi
    REPLY="${REPLY:-$default}"
}

# prompt_secret MSG ENV_NAME: like prompt_default but without echo and
# without a default.
prompt_secret() {
    local msg="$1" env_name="$2"
    if [ -n "${!env_name:-}" ]; then
        REPLY="${!env_name}"
        return
    fi
    if [ "${KURIR_WATCH_NONINTERACTIVE:-0}" = "1" ]; then
        REPLY=""
        return
    fi
    printf '%b%s:%b ' "$BOLD" "$msg" "$NC"
    if [ -t 0 ]; then
        read -rs REPLY
    else
        read -rs REPLY </dev/tty
    fi
    printf '\n'
}

# toml_str VALUE: a double-quoted TOML string.
toml_str() {
    local v="$1"
    v="${v//\\/\\\\}"
    v="${v//\"/\\\"}"
    printf '"%s"' "$v"
}

banner() {
    printf '%b%b' "$CYAN" "$BOLD"
    cat <<'EOF'

  _  __          _       __      __    _      _
 | |/ /  _ _ _ _(_)_ _   \ \    / /_ _| |_ __| |_
 | ' < || | '_| | '_|     \ \/\/ / _` |  _/ _| ' \
 |_|\_\_,_|_| |_|_|        \_/\_/\__,_|\__\__|_||_|

 One-command installer

EOF
    printf '%b' "$NC"
}

usage() {
    cat <<EOF
Usage: install-watch.sh [--reconfigure] [--help]

  --reconfigure   Ask for the account again even though $KURIR_DIR is set up.

Examples:
  sudo ./install-watch.sh
  curl -fsSL https://raw.githubusercontent.com/cfarvidson/kurir-server/main/install-watch.sh | sudo bash
  curl -fsSL https://.../install-watch.sh | sudo bash -s -- --reconfigure
EOF
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --reconfigure) RECONFIGURE=1 ;;
            -h|--help) usage; exit 0 ;;
            *) error "Unknown argument: $1"; usage; exit 2 ;;
        esac
        shift
    done
}

# ---------------------------------------------------------------------------
# Detection & Validation
# ---------------------------------------------------------------------------

check_root() {
    if [ "$(id -u)" -ne 0 ]; then
        fatal "This installer must be run as root (try: sudo bash or curl ... | sudo bash)"
    fi
}

detect_os() {
    if [ ! -f /etc/os-release ]; then
        fatal "Cannot detect OS: /etc/os-release not found"
    fi
    # shellcheck source=/dev/null
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_VERSION="${VERSION_ID:-rolling}"
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
    if docker compose version >/dev/null 2>&1; then
        ok "Docker $(docker version --format '{{.Server.Version}}') with Compose plugin"
    else
        fatal "Docker Compose plugin not found. Install it: https://docs.docker.com/compose/install/"
    fi
}

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

configured() {
    [ -f "$KURIR_DIR/config.toml" ] && [ -f "$KURIR_DIR/.env" ]
}

prompt_config() {
    printf '\n%bYour mail account%b (iCloud: use an app-specific password from appleid.apple.com)\n\n' "$BOLD" "$NC"

    prompt_default "Email address" "" KURIR_WATCH_EMAIL
    EMAIL=$(printf '%s' "$REPLY" | tr -d ' ' | tr '[:upper:]' '[:lower:]')
    case "$EMAIL" in
        *@*) ;;
        *) fatal "An email address is required" ;;
    esac

    prompt_default "IMAP server" "imap.mail.me.com" KURIR_WATCH_IMAP_HOST
    IMAP_HOST="$REPLY"
    prompt_default "IMAP port" "993" KURIR_WATCH_IMAP_PORT
    IMAP_PORT="$REPLY"
    prompt_default "SMTP server" "smtp.mail.me.com" KURIR_WATCH_SMTP_HOST
    SMTP_HOST="$REPLY"
    prompt_default "SMTP port (587 STARTTLS)" "587" KURIR_WATCH_SMTP_PORT
    SMTP_PORT="$REPLY"
    prompt_default "Login username" "$EMAIL" KURIR_WATCH_USERNAME
    USERNAME="$REPLY"
    prompt_secret "Password (not shown)" KURIR_WATCH_PASSWORD
    PASSWORD="$REPLY"
    [ -n "$PASSWORD" ] || fatal "A password is required"
    prompt_default "Display name" "${EMAIL%%@*}" KURIR_WATCH_DISPLAY_NAME
    DISPLAY_NAME="$REPLY"
    prompt_default "Send as (custom domain address, blank for none)" "" KURIR_WATCH_SEND_AS
    SEND_AS="$REPLY"

    printf '\n%bPush and AI%b\n\n' "$BOLD" "$NC"
    prompt_default "Push relay URL (blank to disable push)" "https://kurir-notify.arvidson.io" KURIR_WATCH_RELAY_URL
    RELAY_URL="$REPLY"
    prompt_default "AI rules provider (none, claude_code, anthropic, openai)" "none" KURIR_WATCH_INFERENCE_PROVIDER
    INFERENCE_PROVIDER="$REPLY"
    INFERENCE_TOKEN=""
    INFERENCE_MODEL=""
    case "$INFERENCE_PROVIDER" in
        none|"") INFERENCE_PROVIDER="" ;;
        claude_code|anthropic|openai)
            prompt_secret "AI token (not shown)" KURIR_WATCH_INFERENCE_TOKEN
            INFERENCE_TOKEN="$REPLY"
            [ -n "$INFERENCE_TOKEN" ] || fatal "An AI token is required for provider $INFERENCE_PROVIDER"
            prompt_default "AI model (blank for the provider's default)" "" KURIR_WATCH_INFERENCE_MODEL
            INFERENCE_MODEL="$REPLY"
            ;;
        *) fatal "Unknown AI provider: $INFERENCE_PROVIDER" ;;
    esac
}

write_config() {
    mkdir -p "$KURIR_DIR"
    chmod 750 "$KURIR_DIR"

    local tmp
    tmp=$(mktemp "$KURIR_DIR/.config.toml.XXXXXX")
    {
        echo "# Kurir Watch — written by install-watch.sh. Secrets live in .env."
        echo "data_dir = \"/var/lib/kurir-watch\""
        echo
        echo "[account]"
        echo "imap_host = $(toml_str "$IMAP_HOST")"
        echo "imap_port = $IMAP_PORT"
        echo "imap_tls = true"
        echo "smtp_host = $(toml_str "$SMTP_HOST")"
        echo "smtp_port = $SMTP_PORT"
        echo "smtp_tls = true"
        echo "username = $(toml_str "$USERNAME")"
        echo "email = $(toml_str "$EMAIL")"
        echo "display_name = $(toml_str "$DISPLAY_NAME")"
        if [ -n "$SEND_AS" ]; then
            echo "send_as_email = $(toml_str "$SEND_AS")"
        fi
        if [ -n "$INFERENCE_PROVIDER" ]; then
            echo
            echo "[inference]"
            echo "provider = $(toml_str "$INFERENCE_PROVIDER")"
            if [ -n "$INFERENCE_MODEL" ]; then
                echo "model = $(toml_str "$INFERENCE_MODEL")"
            fi
        fi
        if [ -n "$RELAY_URL" ]; then
            echo
            echo "[push]"
            echo "relay_url = $(toml_str "$RELAY_URL")"
        fi
    } >"$tmp"
    chmod 640 "$tmp"
    mv "$tmp" "$KURIR_DIR/config.toml"

    tmp=$(mktemp "$KURIR_DIR/.env.XXXXXX")
    {
        echo "# Kurir Watch secrets — written by install-watch.sh. Keep this file private."
        echo "KURIR_WATCH_PASSWORD=$PASSWORD"
        if [ -n "$INFERENCE_TOKEN" ]; then
            echo "KURIR_WATCH_INFERENCE_TOKEN=$INFERENCE_TOKEN"
        fi
    } >"$tmp"
    chmod 600 "$tmp"
    mv "$tmp" "$KURIR_DIR/.env"
    ok "Wrote $KURIR_DIR/config.toml and .env (0600)"
}

write_compose() {
    mkdir -p "$KURIR_DIR"
    cat >"$KURIR_DIR/docker-compose.yml" <<EOF
# Kurir Watch — generated by install-watch.sh. Re-run the installer to refresh.
# Manage with: cd $KURIR_DIR && docker compose up -d
services:
  kurir-watch:
    image: $IMAGE
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./config.toml:/etc/kurir-watch/config.toml:ro
      - kurir-watch-data:/var/lib/kurir-watch
    # The container needs nothing but its data directory and the network.
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  kurir-watch-data:
EOF
    ok "Wrote $KURIR_DIR/docker-compose.yml"
}

# ---------------------------------------------------------------------------
# Services
# ---------------------------------------------------------------------------

pull_image() {
    cd "$KURIR_DIR"
    if [ "${KURIR_WATCH_SKIP_PULL:-0}" = "1" ]; then
        info "Skipping image pull (KURIR_WATCH_SKIP_PULL=1)"
        return
    fi
    info "Pulling $IMAGE..."
    docker compose pull --quiet
}

check_login() {
    cd "$KURIR_DIR"
    info "Logging in and syncing once (--check)..."
    if docker compose run --rm --no-deps kurir-watch --check; then
        ok "Login works"
    else
        error "Kurir Watch could not log in. Fix $KURIR_DIR/config.toml or .env and re-run,"
        error "or re-run with --reconfigure to enter the account again."
        exit 1
    fi
}

start_service() {
    cd "$KURIR_DIR"
    docker compose up -d
    ok "Kurir Watch is running"
}

install_update_timer() {
    if ! command -v systemctl >/dev/null 2>&1; then
        warn "No systemd: update by hand with: cd $KURIR_DIR && docker compose pull && docker compose up -d"
        return
    fi
    cat >/etc/systemd/system/kurir-watch-update.service <<EOF
[Unit]
Description=Pull the newest Kurir Watch image and restart it if it changed
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=$KURIR_DIR
ExecStart=/usr/bin/docker compose pull --quiet
ExecStart=/usr/bin/docker compose up -d
ExecStart=/usr/bin/docker image prune -f
EOF
    cat >/etc/systemd/system/kurir-watch-update.timer <<'EOF'
[Unit]
Description=Daily Kurir Watch update

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now kurir-watch-update.timer >/dev/null 2>&1
    ok "Daily update timer enabled (kurir-watch-update.timer)"
}

print_summary() {
    printf '\n%b%bKurir Watch is installed.%b\n\n' "$GREEN" "$BOLD" "$NC"
    info "Files:    $KURIR_DIR (config.toml, .env, docker-compose.yml)"
    info "Data:     docker volume kurir-watch-data"
    info "Logs:     cd $KURIR_DIR && docker compose logs -f"
    info "Update:   automatic once a day; or: cd $KURIR_DIR && docker compose pull && docker compose up -d"
    info "Account:  re-run the installer with --reconfigure"
    printf '\n'
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
    parse_args "$@"
    banner
    check_root
    detect_os
    check_docker

    if configured && [ "$RECONFIGURE" -eq 0 ]; then
        info "Keeping the account in $KURIR_DIR (use --reconfigure to change it)"
        write_compose
        pull_image
        start_service
    else
        prompt_config
        write_config
        write_compose
        pull_image
        check_login
        start_service
    fi
    install_update_timer
    print_summary
}

main "$@"
