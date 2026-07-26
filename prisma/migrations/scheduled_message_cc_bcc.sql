-- Manual migration (production applies SQL explicitly; see CLAUDE.md — never `prisma db push` in prod)
ALTER TABLE "ScheduledMessage"
  ADD COLUMN IF NOT EXISTS "cc" TEXT,
  ADD COLUMN IF NOT EXISTS "bcc" TEXT;
