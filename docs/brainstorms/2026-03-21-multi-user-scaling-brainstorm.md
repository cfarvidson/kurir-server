# Multi-User Scaling Brainstorm

**Date:** 2026-03-21
**Status:** Brainstorm complete

## What We're Building

Scale Kurir from a single-user deployment to support 10-30 users (small group/org — family, team, company). Users should be able to self-register or be invited by an admin, with an admin toggle controlling whether self-service account management is available.

### Target Scale

- 10-30 users, each with 1-2 email connections
- Single server deployment (current Kamal setup, possibly upgraded specs)
- Adding Redis as new infrastructure

## Why This Approach (Hybrid: Optimize + Redis for Sync)

The biggest bottleneck is the sequential sync loop — with 30 users it could take 15+ minutes per cycle. In-memory singletons (ConnectionManager, SSE, echo suppression) are a secondary concern that works fine at this scale in a single process.

The hybrid approach:
1. Fix in-process bottlenecks first (parallel sync, connection caps, memory limits)
2. Add Redis + BullMQ only for the sync job queue
3. Keep SSE and ConnectionManager in-process (they work fine single-process at this scale)

This avoids over-engineering while solving the real problem.

## Key Decisions

### 1. Sync Architecture: BullMQ Job Queue via Redis

Replace the `setInterval` sync loop with BullMQ jobs:
- Per-user sync jobs with configurable intervals
- Concurrency limit (e.g., 5 concurrent syncs)
- Proper retries, backoff, and dead-letter handling
- Priority: recently-active users sync first
- Visibility: admin can see sync queue status

### 2. IDLE Connection Management: Cap and Lazy-Connect

Don't keep IDLE connections open for all users:
- Cap at N concurrent IDLE connections (e.g., 20-30)
- Prioritize users who are currently online (have active SSE connections)
- Lazy-reconnect IDLE for users who open the app
- Graceful disconnect for idle users after timeout

### 3. Prisma Connection Pool: Bump to 15-20

Current default (~5) will saturate with concurrent syncs + API requests. Tune `connection_limit` in the Prisma datasource URL.

### 4. Memory Optimizations + Attachment Lifecycle

- `repairThreadIds()`: Process in chunks instead of loading all messages
- Message parsing: Cap body sizes, limit attachment sizes stored during sync
- **Attachment 30-day expiry**: Store attachment content in DB during sync for fast access. Background job deletes attachment bytes after 30 days. After expiry, lazy-download from IMAP on demand when user clicks. Keeps DB lean while giving fast access to recent mail.

### 5. Onboarding: Admin Invites + Optional Self-Service

- Admin can create users and email connections (existing CLI + new admin UI)
- Self-service signup gated by `SystemSettings.signupsEnabled` (already exists)
- New `SystemSettings.selfServiceAccountManagement` toggle: when ON, users can add/edit/remove their own email connections; when OFF, only admins can manage connections
- Admin UI for user management (list users, disable accounts, manage connections)

### 6. Rate Limiting

- Per-user API rate limiting (Redis-backed)
- Per-user sync frequency caps
- Prevent one user's large mailbox from starving others

### 7. Resource Isolation

- Per-user sync timeouts (kill long-running syncs)
- Memory limits per sync job
- Graceful degradation: if sync fails for one user, others continue unaffected

## Resolved Questions

1. **Server specs** — Upgrade to **8GB RAM**. Comfortable headroom for 30 users with IDLE connections, sync jobs, and Redis.
2. **Attachment storage** — **Keep in Postgres with 30-day expiry**. Store attachments in DB during sync for fast access, but auto-delete attachment content after 30 days. After expiry, fall back to lazy IMAP download when the user requests the attachment. Best of both worlds: fast recent access, no DB bloat.
3. **Admin UI** — **Full dashboard**: user list, sync queue status, connection health, system settings, resource usage.
4. **Monitoring** — **Health endpoint + basic metrics**. `GET /api/health` returns sync queue depth, active connections, memory usage. Good for uptime checks and the admin dashboard.
5. **User isolation** — **userId scoping is sufficient**. Trusted group (family/team), no need for PostgreSQL RLS.

## Work Breakdown (Rough Order)

1. **Prisma pool tuning** — Quick win, config change only
2. **Parallel sync with concurrency limit** — Refactor background-sync.ts
3. **IDLE connection cap** — Refactor ConnectionManager
4. **Memory optimizations** — Chunked thread repair, body size limits
5. **Add Redis + BullMQ** — Replace sync loop with job queue
6. **Rate limiting** — Redis-backed per-user limits
7. **Admin toggle for self-service** — SystemSettings + UI
8. **Admin user management UI** — List users, manage connections
9. **Self-service onboarding flow** — Registration + email connection setup

## Not Doing (YAGNI)

- Horizontal scaling / multi-process — Not needed for 30 users
- Moving SSE to Redis pub/sub — Works fine in-process at this scale
- Separate worker process — BullMQ worker runs in the same Next.js process for now
- Email hosting / MTA — Users bring their own IMAP/SMTP accounts
- Per-user database isolation — userId scoping is sufficient
