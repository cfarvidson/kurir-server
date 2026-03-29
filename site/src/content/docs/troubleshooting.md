---
title: Troubleshooting
description: Solutions for common issues with IMAP connections, sync, Docker, DNS, and more.
order: 7
---

# Troubleshooting

## IMAP connection failures

### Wrong host or port

Make sure you are using the correct IMAP host for your provider:

| Provider | IMAP Host               | Port |
| -------- | ----------------------- | ---- |
| Gmail    | `imap.gmail.com`        | 993  |
| Outlook  | `outlook.office365.com` | 993  |
| iCloud   | `imap.mail.me.com`      | 993  |
| Yahoo    | `imap.mail.yahoo.com`   | 993  |

All connections use TLS on port 993 by default.

### App password required

Most email providers require an **app-specific password** rather than your regular account password when two-factor authentication (2FA) is enabled:

- **Gmail**: Generate at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). You need 2FA enabled first.
- **iCloud**: Generate at [appleid.apple.com](https://appleid.apple.com) under Sign-In and Security > App-Specific Passwords.
- **Yahoo**: Generate at [login.yahoo.com/account/security](https://login.yahoo.com/account/security) under Generate app password.
- **Outlook**: If using OAuth, no app password is needed. Otherwise, check your Microsoft account security settings.

### Two-factor authentication (2FA)

If your provider has 2FA enabled and you are not using OAuth, you **must** use an app password. Regular passwords will be rejected with an authentication error.

## Sync stuck / "Sync already in progress"

If the sync process crashes or is interrupted, the `isSyncing` lock can remain set in the database, blocking future syncs. The lock auto-clears after 5 minutes. If you need to clear it immediately:

```bash
# Docker Compose (production)
docker compose -f docker-compose.production.yml exec postgres \
  psql -U kurir -c 'UPDATE "SyncState" SET "isSyncing" = false;'

# One-command installer
cd /opt/kurir && docker compose exec postgres \
  psql -U kurir -c 'UPDATE "SyncState" SET "isSyncing" = false;'
```

Then trigger a fresh sync:

```bash
docker compose exec app pnpm sync-user --all
```

## Firewall and port issues

Kurir requires ports **80** and **443** to be open for Caddy to serve HTTPS traffic and obtain Let's Encrypt certificates.

Check if the ports are available:

```bash
ss -tlnp | grep -E ':(80|443)\s'
```

If another service is using these ports (e.g. Apache, Nginx), either stop it or configure it as a reverse proxy to Kurir.

For cloud providers, also check your security group / firewall rules to ensure inbound traffic on 80 and 443 is allowed.

## DNS and domain configuration

Caddy needs a valid domain name pointed at your server to provision Let's Encrypt certificates.

1. Create an **A record** pointing your domain (e.g. `mail.example.com`) to your server's public IP.
2. Wait for DNS propagation (usually a few minutes, up to 48 hours).
3. Verify with: `dig +short mail.example.com`

If Caddy fails to obtain a certificate, check its logs:

```bash
docker compose logs proxy
```

Common issues:

- DNS not yet propagated
- Port 80 blocked (Let's Encrypt uses HTTP-01 challenge)
- Rate limiting (too many certificate requests in a short period)

## OAuth token refresh issues

OAuth tokens expire and are refreshed automatically. If token refresh stops working:

- **Microsoft**: Check that your Azure app registration is still active and the client secret has not expired. Client secrets have a configurable expiration (default 6 months to 2 years).
- **Google**: Check that the Gmail API is still enabled in your Google Cloud project and that the OAuth consent screen is not in "Testing" mode with an expired test user.

To re-authenticate, the user can disconnect and reconnect their email account from the Settings page.

## Docker container won't start

### Check container logs

```bash
# All services
docker compose logs

# App only
docker compose logs app

# Last 50 lines
docker compose logs app --tail 50
```

### Common startup errors

**"NEXTAUTH_SECRET is not set"** -- Your `.env` file is missing required variables. See [Configuration](configuration).

**"Connection refused" to PostgreSQL** -- The database container may not be ready yet. The app container has a health check dependency on PostgreSQL, but if you see this in logs, wait a moment and check again.

**Out of memory** -- The default Docker Compose setup limits the app to 1024 MB. If your server has limited RAM, check `docker stats` and consider reducing the `NODE_OPTIONS --max-old-space-size` value.

### Container keeps restarting

Check the exit code:

```bash
docker compose ps
```

An exit code of 137 usually means the container was killed due to memory limits (OOMKilled).

## Database connection errors

**"Connection refused"** -- Verify PostgreSQL is running:

```bash
docker compose ps postgres
```

**"Authentication failed"** -- The `POSTGRES_PASSWORD` in your `.env` must match what PostgreSQL was initialized with. If you change the password after first run, you need to either reset the database volume or update the password inside PostgreSQL directly.

**"Too many connections"** -- The default connection limit is 10 (set in `DATABASE_URL`). If you see this error, restart the app container to release stale connections:

```bash
docker compose restart app
```

## Search not working

Kurir uses PostgreSQL full-text search with a `search_vector` column and GIN index. If search returns no results after a restore or fresh install, the search vector migration may not have been applied:

```bash
docker compose -f docker-compose.production.yml exec -T postgres \
  psql -U kurir < prisma/migrations/search_vector.sql
```

## Getting more help

If your issue is not covered here:

1. Check the [GitHub Issues](https://github.com/cfarvidson/kurir-server/issues) for known problems and solutions.
2. Open a new issue with your Docker logs and environment details (redact secrets).
