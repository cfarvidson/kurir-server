# Deployment Guide

Deploying Kurir using Kamal to Tailscale-connected servers.

## Prerequisites

- [Kamal](https://kamal-deploy.org/) installed (`gem install kamal`)
- A Docker registry (e.g., Docker Hub, GitHub Container Registry, or self-hosted)
- Server(s) accessible via SSH
- Required environment variables set up (see below)

## Configuration

Copy the example files and fill in your values:

```bash
cp config/deploy.yml.example config/deploy.yml
cp .kamal/secrets.example .kamal/secrets
```

Edit `config/deploy.yml` with your server hostnames, registry, and domain. Edit `.kamal/secrets` to reference your environment variables.

## Environment Setup

Set the following environment variables. Use a `.envrc` file with [direnv](https://direnv.net/) to manage these locally.

```bash
# Docker Registry
DOCKER_REGISTRY_TOKEN=your_docker_registry_token

# Database (uses Docker container name — both app and DB are on the same host/network)
KAMAL_DATABASE_URL=postgresql://kurir:YOUR_PASSWORD@kurir-db:5432/kurir
KAMAL_POSTGRES_PASSWORD=YOUR_PASSWORD

# Application secrets (generate with: openssl rand -base64 32)
KAMAL_NEXTAUTH_SECRET=your_nextauth_secret
KAMAL_ENCRYPTION_KEY=your_encryption_key
```

## First-Time Setup

### Tailscale HTTPS (required for passkeys)

On the app server, enable Tailscale Serve to terminate TLS. kamal-proxy serves HTTP on port 80; Tailscale handles HTTPS on port 443:

```bash
sudo tailscale serve --bg --https=443 http://localhost:80
```

### Deploy

```bash
# Provision servers, boot accessories (postgres) and deploy the app
kamal setup

# Apply database schema
kamal app exec "prisma db push --skip-generate"

# Set up full-text search (one-time)
kamal app exec "prisma db execute --file prisma/migrations/search_vector.sql"

# Create the first user
kamal app exec -i "tsx scripts/add-user.ts"
```

## Deployment

```bash
# Ensure changes are committed and pushed
git checkout main
git pull origin main

# Deploy the latest version
kamal deploy
```

The post-deploy hook automatically runs `prisma db push` after each deploy.

## Database Management

```bash
# Apply schema changes (idempotent, safe to re-run)
kamal app exec "prisma db push --skip-generate"

# Check current schema status
kamal app exec "prisma migrate status"

# Add a new user
kamal app exec -i "tsx scripts/add-user.ts"

# Sync emails for a user
kamal app exec "tsx scripts/sync-user.ts --all"

# Direct database access
kamal accessory exec db "psql -U kurir"
```

## Operations

```bash
# Check status of all services
kamal details

# View application logs
kamal app logs -f

# View postgres logs
kamal accessory logs db -f

# Open a shell in the app container
kamal app exec -i /bin/sh

# Node REPL in production
kamal app exec -i node

# Clear stuck sync lock
kamal accessory exec db "psql -U kurir -c 'UPDATE \"SyncState\" SET \"isSyncing\" = false;'"
```

## Backup & Restore

See [docs/BACKUP.md](docs/BACKUP.md) for full documentation.

```bash
# Create a backup (Kamal)
kamal app exec "sh scripts/kurir-backup.sh"

# Create a backup (Docker Compose production)
docker compose -f docker-compose.production.yml exec app sh scripts/kurir-backup.sh

# Copy backup to host
kamal app exec "cat /app/backups/kurir-backup-TIMESTAMP.tar.gz" > backup.tar.gz

# Restore from backup
kamal app exec -i "sh scripts/kurir-restore.sh /app/backups/kurir-backup-TIMESTAMP.tar.gz"

# Restart after restore
kamal app boot
```

Backups include: PostgreSQL dump, Redis snapshot, environment variables.

## Rollback

```bash
# Rollback to the previous version
kamal rollback
```

## Troubleshooting

### Database Connection Errors

- Verify `KAMAL_DATABASE_URL` uses `kurir-db` as the host (Docker container name on the `kamal` network)
- Check that the database service is running: `kamal accessory details db`
- Confirm Tailscale is connected: `tailscale status`

### Authentication Issues

- Ensure `KAMAL_NEXTAUTH_SECRET` is set correctly
- Check `WEBAUTHN_RP_ID` matches the hostname you're accessing the app from

### Docker Registry Access

- Confirm `DOCKER_REGISTRY_TOKEN` is valid
- Test registry access: `docker login docker-registry.banded-beta.ts.net`

### Stuck Sync Lock

If IMAP sync crashes, the lock stays active for 5 minutes. To clear immediately:

```bash
kamal accessory exec db "psql -U kurir -c 'UPDATE \"SyncState\" SET \"isSyncing\" = false;'"
```
