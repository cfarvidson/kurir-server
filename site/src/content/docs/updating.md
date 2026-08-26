---
title: Updating
description: How to update Kurir to the latest version for each deployment method.
order: 8
---

# Updating

Kurir is distributed as a Docker image via GitHub Container Registry (`ghcr.io/cfarvidson/kurir-server:latest`). That tag is the newest _stable_ image. Updating pulls it and restarts the app. Database migrations run automatically on startup, so no manual migration step is needed.

## Admin -> Updates

The admin Updates page polls `latest.json`. Stable is the default channel. **Install betas** follows tagged versions that have not been marked stable yet.

Turning the switch off does not move you back by itself. If the instance is already running an unmarked version, the page says it is ahead of stable and offers **Reinstall stable**. That uses the same pull and health-check path as a normal update, including rollback if the health check fails. It does **not** undo database migrations the beta already applied. There is no clean downgrade once a migration has run.

## Before updating

It is a good idea to [create a backup](backup-restore) before updating, especially for major versions:

```bash
docker compose -f docker-compose.production.yml exec app sh scripts/kurir-backup.sh
```

## One-command installer users

If you used the one-command installer, your installation lives at `/opt/kurir/`.

```bash
cd /opt/kurir
docker compose pull
docker compose up -d
```

This pulls the latest images for all services (app, PostgreSQL, Redis, Caddy) and restarts any containers that have changed. Database migrations are applied automatically when the app starts.

## Docker Compose (manual) users

```bash
cd /path/to/kurir-server
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d
```

## Kamal users

```bash
kamal deploy
```

Kamal builds and pushes a new image from the current codebase, then performs a rolling deploy. Database schema changes are applied automatically by the container entrypoint on startup.

## Database migrations

Database migrations run automatically on application startup: the entrypoint applies the versioned SQL files in `prisma/migrations/` exactly once each, tracked in the `_kurir_migrations` table. You do not need to run anything manually — this includes the full-text search setup.

## Checking for updates

Admin -> Updates is the built-in check. It polls `latest.json` and offers
the pointer for the channel you are on. You can also watch the
[GitHub repository](https://github.com/cfarvidson/kurir-server) or compare
image digests:

```bash
# See what you're running
docker inspect ghcr.io/cfarvidson/kurir-server:latest --format '{{.Id}}' 2>/dev/null

# Pull latest and compare
docker pull ghcr.io/cfarvidson/kurir-server:latest
```

## Rolling back

If an update causes issues, you can roll back to a previous image. First, find the previous image digest in your Docker history, then pin to it:

```bash
# List recently pulled images
docker image ls ghcr.io/cfarvidson/kurir-server

# Restart with a specific digest
# Edit docker-compose.yml to pin: image: ghcr.io/cfarvidson/kurir-server@sha256:abc123...
docker compose up -d
```

Alternatively, restore from a backup taken before the update (see [Backup & Restore](backup-restore)).
