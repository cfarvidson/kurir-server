---
title: "feat: Auto-update mechanism"
type: feat
date: 2026-03-29
---

# Auto-Update Mechanism

## Overview

Implement a safe, automatic update system so self-hosted Kurir stays current without manual intervention. Inspired by Once.com's Campfire model: pull new image, restart, done.

## Problem Statement

Self-hosted users currently have no way to know when a new version is available and must manually check GitHub, pull images, and restart. This leads to stale deployments and missed security patches.

## Proposed Solution

A three-layer system:

1. **Version checking** — periodic API call compares local version against a GitHub-hosted manifest
2. **Admin notification** — new "Updates" tab in the admin dashboard shows update status and history
3. **One-click update** — triggers `docker compose pull && docker compose up -d` with post-restart health verification and auto-rollback

## Technical Approach

### Architecture

```
                          GitHub Releases
                               |
                          latest.json
                               |
            +---------+--------+---------+
            |         |                  |
    [Cron check]  [Manual check]   [Auto-apply]
            |         |                  |
            v         v                  v
    +-------------------------------------------+
    |          SystemSettings (DB)              |
    |  - updateMode (off/notify/auto)           |
    |  - latestVersion, latestImageTag          |
    |  - lastCheckedAt, updateAvailable         |
    +-------------------------------------------+
            |                     |
            v                     v
    [Admin UI: Updates tab]   [Update executor]
                                  |
                          docker compose pull
                          docker compose up -d
                                  |
                          health check /api/up
                                  |
                      +-----------+-----------+
                      |                       |
                  [success]              [rollback]
```

### Implementation Phases

#### Phase 1: Version Manifest & Checker

**Version manifest format** (`latest.json` hosted at a predictable URL):

```json
{
  "version": "0.2.0",
  "image": "ghcr.io/user/kurir-server:0.2.0",
  "releaseUrl": "https://github.com/user/kurir-server/releases/tag/v0.2.0",
  "changelog": "Bug fixes and performance improvements",
  "minVersion": "0.1.0",
  "releasedAt": "2026-03-29T12:00:00Z"
}
```

**Files to create/modify:**

- `src/lib/updates/version-checker.ts` — Fetches manifest, compares semver, stores result in DB
- `src/lib/updates/constants.ts` — Manifest URL, check interval, health check timeout

**DB schema changes** — Extend `SystemSettings` model:

```prisma
model SystemSettings {
  id                           String  @id @default("singleton")
  signupsEnabled               Boolean @default(true)
  selfServiceAccountManagement Boolean @default(true)

  // Auto-update settings
  updateMode          String   @default("notify") // "off" | "notify" | "auto"
  updateManifestUrl   String   @default("https://raw.githubusercontent.com/user/kurir-server/main/latest.json")
  lastUpdateCheck     DateTime?
  latestVersion       String?
  latestImageTag      String?
  latestReleaseUrl    String?
  latestChangelog     String?
  updateAvailable     Boolean  @default(false)
}
```

**New model for update history:**

```prisma
model UpdateLog {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())

  fromVersion  String
  toVersion    String
  status       String   // "started" | "pulling" | "restarting" | "verifying" | "success" | "failed" | "rolled_back"
  error        String?
  durationMs   Int?
  triggeredBy  String   // "manual" | "auto"
  completedAt  DateTime?
}
```

#### Phase 2: API Routes

- `src/app/api/admin/updates/check/route.ts` — `POST`: Trigger version check, return result (admin-only)
- `src/app/api/admin/updates/apply/route.ts` — `POST`: Execute update (admin-only)
- `src/app/api/admin/updates/rollback/route.ts` — `POST`: Rollback to previous version (admin-only)
- `src/app/api/admin/updates/route.ts` — `GET`: Return current update status + history (admin-only)

#### Phase 3: Update Executor

`src/lib/updates/update-executor.ts` — Core update logic:

1. Log update start to `UpdateLog`
2. Run `docker compose pull` (captures output)
3. Run `docker compose up -d` (triggers restart with migration via entrypoint)
4. Poll `/api/up` every 5s for 60s
5. On success: update `UpdateLog` status to "success"
6. On failure: run rollback (re-tag previous image, restart), update log to "rolled_back"

**Key consideration:** The update process restarts the app container, so the response to the admin's "Update Now" request must be sent _before_ the restart. The executor should:
- Return a 202 Accepted immediately
- Execute the update asynchronously via a detached child process or shell script
- The script itself handles health checking and rollback

`scripts/kurir-update.sh` — Shell script that:
```bash
#!/bin/bash
set -e

# Tag current image for rollback
CURRENT_IMAGE=$(docker compose images app --format json | jq -r '.[0].Repository + ":" + .[0].Tag')
docker tag "$CURRENT_IMAGE" kurir-server:rollback 2>/dev/null || true

# Pull new image
docker compose pull app

# Restart (entrypoint handles migrations)
docker compose up -d app

# Health check loop
for i in $(seq 1 12); do
  sleep 5
  if curl -sf http://localhost:3000/api/up > /dev/null 2>&1; then
    echo "UPDATE_SUCCESS"
    exit 0
  fi
done

# Health check failed — rollback
echo "Health check failed, rolling back..."
docker tag kurir-server:rollback "$CURRENT_IMAGE"
docker compose up -d app
echo "UPDATE_ROLLED_BACK"
exit 1
```

#### Phase 4: Admin UI — Updates Tab

Add an "Updates" tab to `AdminTabs` component:

`src/components/admin/updates-section.tsx` — Shows:
- Current version (from `package.json`)
- Latest available version (from DB)
- Update status badge (up-to-date / update available / checking)
- "Check Now" button
- "Update Now" button (with confirmation dialog)
- Update mode selector (off / notify-only / auto-apply)
- Changelog preview
- Update history table (from `UpdateLog`)
- "Rollback" button (if previous version exists)

Modify:
- `src/components/admin/admin-tabs.tsx` — Add "Updates" tab
- `src/app/(admin)/admin/page.tsx` — Fetch update state, pass to UpdatesSection

#### Phase 5: Background Check (Cron)

`src/lib/updates/update-cron.ts` — Scheduled check:
- Runs every 6 hours via `setInterval` in the server process (started in `instrumentation.ts`)
- Calls version checker
- If `updateMode === "auto"` and update available, triggers executor
- If `updateMode === "notify"`, just stores the result (UI will show badge)

Register in `src/instrumentation.ts` (Next.js server startup hook).

## Acceptance Criteria

### Functional Requirements

- [ ] Version manifest URL is configurable via SystemSettings
- [ ] Manual "Check for Updates" works from admin UI
- [ ] Background check runs every 6 hours
- [ ] Admin sees "Update Available" badge with version number and changelog
- [ ] "Update Now" pulls new image, restarts, runs migrations
- [ ] Health check verifies `/api/up` responds within 60s post-restart
- [ ] Auto-rollback triggers if health check fails
- [ ] Manual rollback button available in admin UI
- [ ] Update mode configurable: off / notify-only / auto-apply
- [ ] All updates logged with timestamps, version, outcome
- [ ] Update history visible in admin UI

### Non-Functional Requirements

- [ ] Update check is non-blocking (doesn't affect app performance)
- [ ] Failed update check doesn't crash the app
- [ ] Update process sends response before restarting
- [ ] Works with both Docker Compose and Kamal deployments

## File Change Summary

| File | Action | Purpose |
|------|--------|---------|
| `prisma/schema.prisma` | Edit | Add update fields to SystemSettings, add UpdateLog model |
| `src/lib/updates/version-checker.ts` | Create | Fetch manifest, compare versions |
| `src/lib/updates/update-executor.ts` | Create | Orchestrate update process |
| `src/lib/updates/constants.ts` | Create | Manifest URL, intervals, timeouts |
| `src/app/api/admin/updates/route.ts` | Create | GET update status + history |
| `src/app/api/admin/updates/check/route.ts` | Create | POST trigger version check |
| `src/app/api/admin/updates/apply/route.ts` | Create | POST trigger update |
| `src/app/api/admin/updates/rollback/route.ts` | Create | POST trigger rollback |
| `scripts/kurir-update.sh` | Create | Shell script for update + health check + rollback |
| `src/components/admin/updates-section.tsx` | Create | Updates tab UI |
| `src/components/admin/admin-tabs.tsx` | Edit | Add "Updates" tab |
| `src/app/(admin)/admin/page.tsx` | Edit | Fetch update state, pass to Updates tab |
| `src/instrumentation.ts` | Edit | Register background update check cron |

## Edge Cases Considered

- **Network failure during manifest check**: Catches error, logs warning, retries at next interval. No user-facing error.
- **Manifest URL unreachable**: Graceful fallback — admin sees "Last checked: X ago, check failed" instead of crashing.
- **App restarts during update**: The shell script runs outside the Node process, so it survives the container restart.
- **Multiple admins clicking "Update"**: Mutex via UpdateLog — if status is "started"/"pulling"/"restarting", reject new requests.
- **Docker socket not available**: Update will fail with clear error. The app container needs Docker socket mounted for self-update.
- **Version downgrade attempt**: Compare semver — don't offer "updates" to older versions.
- **First run (no previous checks)**: Show "Never checked" state, prompt admin to check.
- **Same version re-released**: Compare image digest, not just version string (future enhancement).

## Dependencies & Risks

- **Docker socket access**: The app container needs `/var/run/docker.sock` mounted to run `docker compose` commands. This is a security consideration — documented but required for self-update.
- **Migration failures**: If `prisma db push` fails during entrypoint, the container won't start, triggering rollback via health check. This is the desired behavior.
- **Disk space**: Need enough space for two images (current + new). Cleanup old images after successful update.

## References

- `src/app/(admin)/admin/page.tsx` — Admin dashboard page
- `src/components/admin/health-section.tsx` — Health tab (pattern for Updates tab)
- `src/components/admin/admin-tabs.tsx` — Tab navigation
- `src/app/api/up/route.ts` — Health check endpoint
- `src/app/api/admin/health/route.ts` — Admin health API
- `scripts/docker-entrypoint.sh` — Migration runner
- `scripts/kurir-backup.sh` — Backup script (pattern for update script)
- `docker-compose.yml` — Docker services config
- `prisma/schema.prisma` — Data model with SystemSettings
- Once.com Campfire update model (inspiration)
