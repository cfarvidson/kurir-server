---
title: Backup & Restore
description: How to back up and restore your Kurir instance, including scheduled automatic backups.
order: 11
---

# Backup & Restore

Kurir has two kinds of backup:

- **Instance backups** - built-in scripts that back up and restore everything on the server: the database, Redis and the configuration. Most of this page covers them.
- **Settings backups** - a copy of one user's contacts, screening and preferences, saved as a mail in that user's own Sent folder. See [Settings backups](#settings-backups) below.

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

## Settings backups

A settings backup is a snapshot of your contacts and contact groups, your screening decisions (senders, domain rules and subject rules) and your preferences (theme, time zone, image blocking, badges). It is saved as a mail in your own Sent folder, so it lives with your email provider and survives a lost or reinstalled server. Email messages are not included.

Open **Settings → Settings backup**:

- **Schedule** - **Off**, **Daily** (03:00 local time) or **Weekly** (same weekday, 03:00).
- **Backup now** saves a copy right away.
- **Saved copies** lists the backups found in Sent, with **Restore** on each. Kurir keeps the newest four and removes older ones.

When you set up Kurir again with the same mailbox, the setup wizard looks for backups in Sent after the first sync and asks **Restore your settings?**. Pick one, or skip and start clean. Settings for email accounts that are not connected are skipped, and Kurir tells you which.

A settings backup does not contain passwords, tokens or AI rules.

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

**Search not working after restore** -- The restore script re-applies every versioned SQL file in `prisma/migrations/` (idempotent). If it fails, run the migration runner with `DATABASE_URL` set:

```bash
sh scripts/apply-migrations.sh
```
