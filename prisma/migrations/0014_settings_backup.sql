-- Settings takeout cadence on User.
-- Idempotent: safe to re-run on instances created via prisma db push.
-- Applied by scripts/apply-migrations.sh.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "settingsBackupCadence" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "settingsBackupNextRunAt" TIMESTAMP(3);
