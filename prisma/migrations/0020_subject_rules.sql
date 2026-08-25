-- Subject screening rules (kurir-ios#48): route individual messages whose
-- subject contains a pattern (case-insensitive), overriding the sender's
-- decision. Evaluated per message at ingest.
-- Idempotent: safe to re-run on instances created via `prisma db push`.
DO $$ BEGIN
  CREATE TYPE "SubjectRuleScope" AS ENUM ('ADDRESS', 'DOMAIN', 'SUBDOMAINS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SubjectRule" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "scope" "SubjectRuleScope" NOT NULL,
  "scopeValue" TEXT NOT NULL,
  "pattern" TEXT NOT NULL,
  "status" "SenderStatus" NOT NULL,
  "category" "SenderCategory",
  "userId" TEXT NOT NULL,
  "emailConnectionId" TEXT NOT NULL,

  CONSTRAINT "SubjectRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubjectRule_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SubjectRule_emailConnectionId_fkey" FOREIGN KEY ("emailConnectionId")
    REFERENCES "EmailConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS
  "SubjectRule_emailConnectionId_scope_scopeValue_pattern_key"
  ON "SubjectRule" ("emailConnectionId", "scope", "scopeValue", "pattern");

CREATE INDEX IF NOT EXISTS "SubjectRule_emailConnectionId_idx"
  ON "SubjectRule" ("emailConnectionId");

-- Provenance: which subject rule filed a message (nulled when the rule is
-- deleted, placement kept).
ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "subjectRuleId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Message"
    ADD CONSTRAINT "Message_subjectRuleId_fkey" FOREIGN KEY ("subjectRuleId")
      REFERENCES "SubjectRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Message_subjectRuleId_idx"
  ON "Message" ("subjectRuleId");
