-- Install-betas channel on SystemSettings. Existing rows keep the default
-- (stable); the migration must not flip instances already in the field.
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- Applied by scripts/apply-migrations.sh.

ALTER TABLE "SystemSettings"
  ADD COLUMN IF NOT EXISTS "updateChannel" TEXT NOT NULL DEFAULT 'stable';
