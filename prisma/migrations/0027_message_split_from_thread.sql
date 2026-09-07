-- Branch threads (plan 055): a reply to an own bcc-only broadcast starts a
-- thread per replying address. Every row in such a branch carries the
-- broadcast thread's key here. Idempotent.

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "splitFromThreadId" TEXT;

CREATE INDEX IF NOT EXISTS "Message_userId_splitFromThreadId_idx"
  ON "Message" ("userId", "splitFromThreadId");
