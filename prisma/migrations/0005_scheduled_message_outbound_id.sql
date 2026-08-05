-- Manual migration (production applies SQL explicitly; see CLAUDE.md — never `prisma db push` in prod)
ALTER TABLE "ScheduledMessage" ADD COLUMN IF NOT EXISTS "outboundMessageId" TEXT;
