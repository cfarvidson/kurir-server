-- Whether the release image behind latestImageTag was found in the registry
-- at the last check. NULL means not checked yet (fresh rows, or the probe
-- failed), so Admin -> Updates keeps "Update now" disabled until a check
-- succeeds. Idempotent: ADD COLUMN IF NOT EXISTS.
-- Applied by scripts/apply-migrations.sh.

ALTER TABLE "SystemSettings"
  ADD COLUMN IF NOT EXISTS "imageAvailable" BOOLEAN;

ALTER TABLE "SystemSettings"
  ADD COLUMN IF NOT EXISTS "imageCheckedAt" TIMESTAMP(3);
