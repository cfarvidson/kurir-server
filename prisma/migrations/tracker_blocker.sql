-- Spy-tracker blocker: per-user default + per-sender allowlist.
-- Production applies schema changes as explicit SQL (prisma db push is disabled
-- because the prod DB shares its instance with the unrelated 'epoch' app).
-- Run with: bin/deploy app exec --reuse "psql \"\$DATABASE_URL\" -f -" < prisma/migrations/tracker_blocker.sql
-- (or pipe via docker compose exec -T postgres psql -U kurir < prisma/migrations/tracker_blocker.sql in dev)

-- 1. User: block remote images / tracking pixels by default
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "blockRemoteImages" boolean NOT NULL DEFAULT true;

-- 2. Sender: per-sender allowlist override ("always show images from X")
ALTER TABLE "Sender"
  ADD COLUMN IF NOT EXISTS "allowRemoteImages" boolean NOT NULL DEFAULT false;
