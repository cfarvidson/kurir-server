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

Edit `config/deploy.yml` with your server hostnames, registry, and domain. Edit `.kamal/secrets` to reference `$KAMAL_*` environment variables. Put the actual values in `~/.kamal/kurir-secrets.env` (mode 0600, outside the repo) and always invoke Kamal via `bin/deploy`. Bare `kamal` without that file injects empty secrets and wipes production config.

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
bin/deploy setup

# Schema and versioned migrations are applied automatically by the
# container entrypoint on boot — nothing to run manually.

# Create the first user
bin/deploy app exec -i "tsx scripts/add-user.ts"
```

## Deployment

```bash
# Ensure changes are committed and pushed
git checkout main
git pull origin main

# Deploy the latest version
bin/deploy
```

The container entrypoint runs `scripts/apply-migrations.sh` on boot. Existing installs never use `prisma db push` (the production database shares its instance with unrelated tables that `db push` would try to drop). Ad-hoc SQL:

```bash
bin/deploy app exec --reuse "psql \"$DATABASE_URL\" -c '...'"
```

## Database Management

```bash
# Add a new user
bin/deploy app exec -i "tsx scripts/add-user.ts"

# Sync emails for a user
bin/deploy app exec "tsx scripts/sync-user.ts --all"

# Direct database access
bin/deploy accessory exec db "psql -U kurir"
```

## Operations

```bash
# Check status of all services
bin/deploy details

# View application logs
bin/deploy app logs -f

# View postgres logs
bin/deploy accessory logs db -f

# Open a shell in the app container
bin/deploy app exec -i /bin/sh

# Node REPL in production
bin/deploy app exec -i node

# Clear stuck sync lock
bin/deploy accessory exec db "psql -U kurir -c 'UPDATE \"SyncState\" SET \"isSyncing\" = false;'"
```

## Backup & Restore

See [docs/BACKUP.md](docs/BACKUP.md) for full documentation.

```bash
# Create a backup (Kamal)
bin/deploy app exec "sh scripts/kurir-backup.sh"

# Create a backup (Docker Compose production)
docker compose -f docker-compose.production.yml exec app sh scripts/kurir-backup.sh

# Copy backup to host
bin/deploy app exec "cat /app/backups/kurir-backup-TIMESTAMP.tar.gz" > backup.tar.gz

# Restore from backup
bin/deploy app exec -i "sh scripts/kurir-restore.sh /app/backups/kurir-backup-TIMESTAMP.tar.gz"

# Restart after restore
bin/deploy app boot
```

Backups include: PostgreSQL dump, Redis snapshot, environment variables.

## Rollback

```bash
# Rollback to the previous version
bin/deploy rollback
```

## Troubleshooting

### Database Connection Errors

- Verify `KAMAL_DATABASE_URL` uses `kurir-db` as the host (Docker container name on the `kamal` network)
- Check that the database service is running: `bin/deploy accessory details db`
- Confirm Tailscale is connected: `tailscale status`

### Authentication Issues

- Ensure `KAMAL_NEXTAUTH_SECRET` is set correctly
- Check `WEBAUTHN_RP_ID` matches the hostname you're accessing the app from

### Docker Registry Access

- Confirm `DOCKER_REGISTRY_TOKEN` is valid
- Test registry access: `docker login your-registry.example.com`

### Stuck Sync Lock

If IMAP sync crashes, the lock stays active for 5 minutes. To clear immediately:

```bash
bin/deploy accessory exec db "psql -U kurir -c 'UPDATE \"SyncState\" SET \"isSyncing\" = false;'"
```
