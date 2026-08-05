-- Examined-UID watermark per folder: stops Archive/All Mail syncs from
-- re-fetching dedup-skipped messages as "new" on every cycle.
-- Applied manually (see scripts/docker-entrypoint.sh for the policy):
--   docker exec kurir-db psql -U kurir -d kurir -f - < this file
ALTER TABLE "Folder"
  ADD COLUMN IF NOT EXISTS "lastExaminedUid" INTEGER NOT NULL DEFAULT 0;
