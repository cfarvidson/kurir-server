-- Private per-thread notes, and a snapshot of the AI content-rule action
-- applied when a message was judged. Idempotent: safe to re-run on
-- instances created via `prisma db push`.

ALTER TABLE "ContentRuleMatch"
  ADD COLUMN IF NOT EXISTS "appliedAction" "ContentRuleAction";

UPDATE "ContentRuleMatch" AS m
SET "appliedAction" = CASE
  WHEN m."matched" THEN r."onMatch"
  ELSE r."onNoMatch"
END
FROM "ContentRule" AS r
WHERE r."id" = m."ruleId"
  AND m."appliedAction" IS NULL;

-- Rows that somehow have no parent rule are dropped rather than blocking
-- the NOT NULL. The match is meaningless without the rule.
DELETE FROM "ContentRuleMatch" WHERE "appliedAction" IS NULL;

ALTER TABLE "ContentRuleMatch"
  ALTER COLUMN "appliedAction" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "ThreadNote" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "body" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,

  CONSTRAINT "ThreadNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ThreadNote_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ThreadNote_userId_threadId_key"
  ON "ThreadNote" ("userId", "threadId");
CREATE INDEX IF NOT EXISTS "ThreadNote_userId_idx"
  ON "ThreadNote" ("userId");
