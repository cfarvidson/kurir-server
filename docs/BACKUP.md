# Backup & Restore

Back up and restore your self-hosted Kurir instance data.

## What's Included

| Component   | File           | Description                                             |
| ----------- | -------------- | ------------------------------------------------------- |
| PostgreSQL  | `database.sql` | Full database dump (users, messages, senders, settings) |
| Redis       | `redis.rdb`    | Point-in-time RDB snapshot (BullMQ queues, cache)       |
| Environment | `env.backup`   | App configuration variables (includes encryption keys)  |

Backups do **not** include Docker images, `node_modules`, or uploaded files outside the database.

## Creating a Backup

```bash
# Docker Compose (production)
docker compose -f docker-compose.production.yml exec app sh scripts/kurir-backup.sh

# Docker Compose (development)
docker compose exec app sh scripts/kurir-backup.sh

# Inside the container
sh scripts/kurir-backup.sh
```

The backup is saved to `/app/backups/` (a persistent Docker volume) as a timestamped `.tar.gz` archive.

### Options

```
--output-dir DIR   Save backup to a custom directory
--no-redis         Skip Redis snapshot
--no-env           Skip environment variable export
--quiet            Suppress progress messages
```

### Copy Backup to Host

```bash
# Find the backup file
docker compose -f docker-compose.production.yml exec app ls /app/backups/

# Copy to host
docker compose -f docker-compose.production.yml cp app:/app/backups/kurir-backup-2025-01-15-120000.tar.gz ./
```

## Restoring from Backup

```bash
# Copy backup into the container (if not already in /app/backups/)
docker compose -f docker-compose.production.yml cp ./kurir-backup-2025-01-15-120000.tar.gz app:/app/backups/

# Restore
docker compose -f docker-compose.production.yml exec app sh scripts/kurir-restore.sh /app/backups/kurir-backup-2025-01-15-120000.tar.gz
```

The restore script will:

1. Validate the archive and verify checksums
2. Show backup details (date, size, contents)
3. Ask for confirmation before proceeding
4. Restore the PostgreSQL database
5. Flush and restore Redis data
6. Re-apply the search vector migration
7. Print any environment variable differences for manual review

### Options

```
--yes, -y       Skip confirmation prompt (for automated restores)
--skip-redis    Skip Redis restore
```

### After Restoring

Restart the app to pick up restored data:

```bash
docker compose -f docker-compose.production.yml restart app
```

If the backup included environment variables, review them and update your `.env` file if needed.

## Scheduled Backups

Set up a cron job on the Docker host for automatic daily backups:

```bash
# Edit crontab
crontab -e

# Daily backup at 2 AM, keep last 7 days
0 2 * * * docker compose -f /path/to/docker-compose.production.yml exec -T app sh -c 'sh scripts/kurir-backup.sh --quiet && find /app/backups -name "kurir-backup-*.tar.gz" -mtime +7 -delete'
```

The `-T` flag disables TTY allocation (required for cron).

## Security Considerations

- Backup archives contain **sensitive data**: database credentials, encryption keys, OAuth tokens, and email content
- Store backups in a secure location with restricted access
- The `env.backup` file contains `ENCRYPTION_KEY` — without it, encrypted passwords in the database cannot be decrypted
- Consider encrypting backup archives before off-site storage:
  ```bash
  gpg --symmetric --cipher-algo AES256 kurir-backup-*.tar.gz
  ```

## Backup Archive Structure

```
kurir-backup-YYYY-MM-DD-HHMMSS.tar.gz
├── manifest.json    # Metadata, checksums, format version
├── database.sql     # PostgreSQL plain-text dump
├── redis.rdb        # Redis RDB snapshot (if included)
└── env.backup       # Environment variables (if included)
```

## Troubleshooting

**"pg_dump not found"** — The production Docker image includes PostgreSQL client tools. If running outside Docker, install `postgresql-client`.

**"redis-cli not found"** — Same as above; the production image includes Redis tools. Use `--no-redis` to skip Redis backup if unavailable.

**Restore fails with permission errors** — Ensure the `DATABASE_URL` user has privileges to drop/create tables. The default `kurir` user has full access.

**Search not working after restore** — The restore script re-applies the search vector migration automatically. If it fails, run manually:

```bash
docker compose -f docker-compose.production.yml exec -T postgres psql -U kurir < prisma/migrations/search_vector.sql
```
