-- AI content rules: a natural-language criterion evaluated by the user's own
-- draft-generation model against mail from the rule's senders, with an
-- action per verdict. Idempotent: safe to re-run on instances created via
-- `prisma db push`.
DO $$ BEGIN
  CREATE TYPE "ContentRuleAction" AS ENUM ('KEEP', 'IMBOX', 'FEED', 'PAPER_TRAIL', 'ARCHIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ContentRule" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "criterion" TEXT NOT NULL,
  "onMatch" "ContentRuleAction" NOT NULL DEFAULT 'KEEP',
  "onNoMatch" "ContentRuleAction" NOT NULL DEFAULT 'KEEP',
  "userId" TEXT NOT NULL,
  "emailConnectionId" TEXT,

  CONSTRAINT "ContentRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentRule_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContentRule_emailConnectionId_fkey" FOREIGN KEY ("emailConnectionId")
    REFERENCES "EmailConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ContentRule_userId_idx" ON "ContentRule" ("userId");
CREATE INDEX IF NOT EXISTS "ContentRule_emailConnectionId_idx"
  ON "ContentRule" ("emailConnectionId");

CREATE TABLE IF NOT EXISTS "ContentRuleSender" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scope" "SubjectRuleScope" NOT NULL,
  "scopeValue" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,

  CONSTRAINT "ContentRuleSender_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentRuleSender_ruleId_fkey" FOREIGN KEY ("ruleId")
    REFERENCES "ContentRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContentRuleSender_ruleId_scope_scopeValue_key"
  ON "ContentRuleSender" ("ruleId", "scope", "scopeValue");

CREATE TABLE IF NOT EXISTS "ContentRuleMatch" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "matched" BOOLEAN NOT NULL,
  "reason" TEXT,
  "ruleId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,

  CONSTRAINT "ContentRuleMatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentRuleMatch_ruleId_fkey" FOREIGN KEY ("ruleId")
    REFERENCES "ContentRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContentRuleMatch_messageId_fkey" FOREIGN KEY ("messageId")
    REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContentRuleMatch_ruleId_messageId_key"
  ON "ContentRuleMatch" ("ruleId", "messageId");
CREATE INDEX IF NOT EXISTS "ContentRuleMatch_messageId_idx"
  ON "ContentRuleMatch" ("messageId");
CREATE INDEX IF NOT EXISTS "ContentRuleMatch_ruleId_matched_idx"
  ON "ContentRuleMatch" ("ruleId", "matched");
