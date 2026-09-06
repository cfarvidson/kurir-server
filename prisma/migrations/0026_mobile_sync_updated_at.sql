-- Mobile delta-sync (GET /api/mobile/sync) filters/orders Message and Sender
-- by (userId, updatedAt). Idempotent.

CREATE INDEX IF NOT EXISTS "Message_userId_updatedAt_idx"
  ON "Message" ("userId", "updatedAt");

CREATE INDEX IF NOT EXISTS "Sender_userId_updatedAt_idx"
  ON "Sender" ("userId", "updatedAt");
