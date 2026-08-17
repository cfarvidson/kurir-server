# Settings backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** User-facing settings takeout stored as dummy Sent mail so a wipe plus reconnect can restore contacts, screening, and preferences.

**Architecture:** Pure payload/cadence modules, one write/apply/list core, persist-sent + IMAP APPEND (no SMTP), User cadence fields, maintenance job, Settings UI, setup picker after first sync.

**Tech Stack:** Next.js, Prisma, Vitest, BullMQ, ImapFlow

**Spec:** `docs/specs/2026-08-17-settings-backup-design.md`

## Global Constraints

- JSON must not contain email messages
- Dummy Sent: no SMTP; local row + IMAP APPEND
- Identity is addresses, never Kurir ids
- Keep last 4 dummy backups
- Scheduled success requires APPEND
- Backup now does not move nextRunAt
- Overlay restore; explicit senders win over domain rules

## Files

- Create: `src/lib/mail/settings-backup-payload.ts`
- Create: `src/lib/mail/settings-backup-cadence.ts`
- Create: `src/lib/mail/settings-backup.ts`
- Create: `src/actions/settings-backup.ts`
- Create: `src/components/settings/settings-backup.tsx`
- Create: `src/__tests__/unit/settings-backup-payload.test.ts`
- Create: `src/__tests__/unit/settings-backup-cadence.test.ts`
- Create: `src/__tests__/unit/settings-backup.test.ts`
- Create: `prisma/migrations/0014_settings_backup.sql`
- Modify: `prisma/schema.prisma` (User cadence fields)
- Modify: `src/lib/jobs/maintenance-worker.ts`
- Modify: `src/app/(mail)/settings/page.tsx`
- Modify: `src/components/auth/setup-wizard.tsx`

## Tasks

1. Payload parse/serialize/detect (pure) + tests
2. Cadence next-run math (pure) + tests
3. Prisma fields + SQL migration
4. snapshot / write / list / apply / prune + mocked tests
5. Server actions + maintenance task
6. Settings Mail tab Backup section
7. Setup wizard picker after sync
