---
title: Installation
description: Step-by-step instructions for installing Kurir using the one-command installer, Docker Compose, or Kamal.
order: 2
---

# Installation

Kurir runs as a set of Docker containers: the Next.js application, PostgreSQL, Redis, and a Caddy reverse proxy for automatic HTTPS. Choose the option that fits your setup.

## Option A: One-command installer

The recommended way to get Kurir running on a fresh Ubuntu 22.04+ or Debian 12+ server.

### Run the installer

```bash
curl -fsSL https://raw.githubusercontent.com/cfarvidson/kurir-server/main/install.sh | sudo sh
```

### What the installer does

The script is idempotent -- safe to re-run at any time. Existing secrets are preserved on subsequent runs.

1. **Checks prerequisites** -- Verifies the OS (Ubuntu 22.04+ or Debian 12+), architecture (amd64 or arm64), root access, Docker 20+ with Compose plugin, and that ports 80 and 443 are available.
2. **Prompts for configuration** -- Asks for your domain name (e.g. `mail.example.com`) and email address (for Let's Encrypt certificates).
3. **Generates secrets** -- Creates cryptographically random values for the database password, Redis password, NextAuth secret, encryption key, and VAPID keys (for push notifications). Uses `openssl rand -base64 32`.
4. **Writes configuration** -- Saves the `.env` file to `/opt/kurir/` with restrictive permissions (chmod 600).
5. **Creates the Caddyfile** -- Configures Caddy as a reverse proxy with automatic HTTPS, gzip/zstd compression, security headers, and static asset caching.
6. **Writes docker-compose.yml** -- Generates the Compose file with all four services: Caddy (proxy), the Kurir app, PostgreSQL 16, and Redis 7.
7. **Pulls images and starts services** -- Downloads the container images from `ghcr.io/cfarvidson/kurir-server:latest` and starts everything.
8. **Waits for health check** -- Polls the app's `/api/up` endpoint until it reports healthy (up to 5 minutes).

### After the installer finishes

Open `https://your-domain.com` in your browser. The first-run setup wizard will guide you through creating your admin account and connecting your email.

### Managing your installation

```bash
cd /opt/kurir
docker compose logs -f                              # Tail all logs
docker compose logs app -f                          # App logs only
docker compose restart app                          # Restart the app
docker compose pull && docker compose up -d         # Update to latest
```

## Option B: Docker Compose (manual)

The same stack as the installer, configured by hand. Use this if you want more control over the setup or are running on a non-Debian system.

### 1. Clone the repository

```bash
git clone https://github.com/cfarvidson/kurir-server.git
cd kurir-server
```

### 2. Configure environment

```bash
cp .env.production.example .env
```

Edit `.env` and set at minimum:

- `DOMAIN` -- Your server's public domain name
- `POSTGRES_PASSWORD` -- Generate with `openssl rand -base64 32`
- `REDIS_PASSWORD` -- Generate with `openssl rand -base64 32`
- `NEXTAUTH_SECRET` -- Generate with `openssl rand -base64 32`
- `ENCRYPTION_KEY` -- Generate with `openssl rand -base64 32`

See the full [Configuration](configuration) reference for all options.

### 3. Start services

```bash
docker compose -f docker-compose.production.yml up -d
```

This starts Caddy (reverse proxy with auto Let's Encrypt), the Next.js app, PostgreSQL, and Redis. Database migrations run automatically on startup.

### 4. Complete setup

Open `https://your-domain.com` to run the first-run setup wizard.

## Option C: Kamal (multi-host)

For deploying across multiple Tailscale-connected servers with a private Docker registry. This is the most advanced option, intended for users comfortable with multi-host deployments.

Configuration lives in `config/deploy.yml` and `.kamal/secrets`. See the [DEPLOY.md](https://github.com/cfarvidson/kurir-server/blob/main/DEPLOY.md) file in the repository for the full guide.

```bash
kamal setup    # First deploy: provisions server, boots accessories + app
kamal deploy   # Subsequent deploys
```

Post-deploy hooks automatically run `prisma db push` to apply schema changes. The search vector migration must be run manually once:

```bash
kamal app exec "npx prisma db execute --file prisma/migrations/search_vector.sql"
```

## First-run setup wizard

After any installation method, visiting your Kurir instance for the first time will present a setup wizard that walks you through:

1. **Creating your admin account** -- Choose a username and password.
2. **Connecting your email** -- Enter your IMAP/SMTP credentials or use OAuth for Gmail/Outlook.
3. **Initial sync** -- Kurir fetches your recent emails and populates the Screener.

Once setup is complete, new senders will appear in the Screener for you to approve or reject.
