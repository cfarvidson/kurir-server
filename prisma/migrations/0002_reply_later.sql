-- Reply Later feature: per-message flag + badge preference.
-- Production applies schema changes as explicit SQL (prisma db push is disabled
-- because the prod DB shares its instance with the unrelated 'epoch' app).
-- Run with: bin/deploy app exec --reuse "psql \"\$DATABASE_URL\" -f -" < prisma/migrations/reply_later.sql
-- (or pipe via docker compose exec -T postgres psql -U kurir < prisma/migrations/reply_later.sql in dev)

-- 1. Message: "Reply Later" flag (thread owes a reply)
ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "isReplyLater" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Message_userId_isReplyLater_idx"
  ON "Message" ("userId", "isReplyLater");

-- 2. User: show the Reply Later sidebar badge (defaults on)
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "showReplyLaterBadge" boolean NOT NULL DEFAULT true;
