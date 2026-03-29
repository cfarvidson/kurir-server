---
title: Backup & Restore
description: How to back up and restore your Kurir instance, including scheduled automatic backups.
order: 5
---

# Backup & Restore

Kurir includes built-in scripts for backing up and restoring your entire instance data.

## What's included in a backup

| Component   | File           | Description                                             |
| ----------- | -------------- | ------------------------------------------------------- |
| PostgreSQL  | `database.sql` | Full database dump (users, messages, senders, settings) |
| Redis       | `redis.rdb`    | Point-in-time RDB snapshot (BullMQ queues, cache)       |
| Environment | `env.backup`   | App configuration variables (includes encryption keys)  |

Backups do **not** include Docker images, `node_modules`, or uploaded files outside the database.

### Archive structure

```
kurir-backup-YYYY-MM-DD-HHMMSS.tar.gz
├── manifest.json    # Metadata, checksums, format version
├── database.sql     # PostgreSQL plain-text dump
├── redis.rdb        # Redis RDB snapshot (if included)
└── env.backup       # Environment variables (if included)
```

## Creating a backup

```bash
# Docker Compose (production)
docker compose -f docker-compose.production.yml exec app sh scripts/kurir-backup.sh

# Docker Compose (development)
docker compose exec app sh scripts/kurir-backup.sh

# Inside the container directly
sh scripts/kurir-backup.sh
```

The backup is saved to `/app/backups/` (a persistent Docker volume) as a timestamped `.tar.gz` archive.

### Backup options

```
--output-dir DIR   Save backup to a custom directory
--no-redis         Skip Redis snapshot
--no-env           Skip environment variable export
--quiet            Suppress progress messages
```

### Copy the backup to your host machine

```bash
# Find the backup file
docker compose -f docker-compose.production.yml exec app ls /app/backups/

# Copy to host
docker compose -f docker-compose.production.yml cp \
  app:/app/backups/kurir-backup-2025-01-15-120000.tar.gz ./
```

## Restoring from backup

```bash
# Copy backup into the container (if not already in /app/backups/)
docker compose -f docker-compose.production.yml cp \
  ./kurir-backup-2025-01-15-120000.tar.gz app:/app/backups/

# Restore
docker compose -f docker-compose.production.yml exec app \
  sh scripts/kurir-restore.sh /app/backups/kurir-backup-2025-01-15-120000.tar.gz
```

### What the restore script does

1. Validates the archive and verifies checksums.
2. Shows backup details (date, size, contents).
3. Asks for confirmation before proceeding.
4. Restores the PostgreSQL database.
5. Flushes and restores Redis data.
6. Re-applies the search vector migration.
7. Prints any environment variable differences for manual review.

### Restore options

```
--yes, -y       Skip confirmation prompt (for automated restores)
--skip-redis    Skip Redis restore
```

### After restoring

Restart the app to pick up the restored data:

```bash
docker compose -f docker-compose.production.yml restart app
```

If the backup included environment variables, review the printed diff and update your `.env` file if needed.

## Scheduling automatic backups

Set up a cron job on the Docker host for automatic daily backups:

```bash
# Edit crontab
crontab -e

# Daily backup at 2 AM, keep last 7 days
0 2 * * * docker compose -f /path/to/docker-compose.production.yml exec -T app sh -c 'sh scripts/kurir-backup.sh --quiet && find /app/backups -name "kurir-backup-*.tar.gz" -mtime +7 -delete'
```

The `-T` flag disables TTY allocation, which is required for cron.

## Security considerations

Backup archives contain **sensitive data**: database credentials, encryption keys, OAuth tokens, and email content. Handle them carefully:

- Store backups in a secure location with restricted access.
- The `env.backup` file contains `ENCRYPTION_KEY` -- without it, encrypted passwords in the database cannot be decrypted.
- Consider encrypting backup archives before off-site storage:

```bash
gpg --symmetric --cipher-algo AES256 kurir-backup-*.tar.gz
```

## Troubleshooting

**"pg_dump not found"** -- The production Docker image includes PostgreSQL client tools. If running outside Docker, install `postgresql-client`.

**"redis-cli not found"** -- Same as above; the production image includes Redis tools. Use `--no-redis` to skip Redis backup if unavailable.

**Restore fails with permission errors** -- Ensure the `DATABASE_URL` user has privileges to drop/create tables. The default `kurir` user has full access.

**Search not working after restore** -- The restore script re-applies the search vector migration automatically. If it fails, run manually:

```bash
docker compose -f docker-compose.production.yml exec -T postgres \
  psql -U kurir < prisma/migrations/search_vector.sql
```
