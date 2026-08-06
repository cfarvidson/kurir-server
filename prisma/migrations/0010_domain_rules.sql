-- Domain screening rules (plan 033): auto-approve/reject new senders from a
-- domain (optionally including subdomains) at sync time.
-- Idempotent: safe to re-run on instances created via `prisma db push`.
CREATE TABLE IF NOT EXISTS "DomainRule" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "pattern" TEXT NOT NULL,
  "includeSubdomains" BOOLEAN NOT NULL DEFAULT false,
  "status" "SenderStatus" NOT NULL,
  "category" "SenderCategory",
  "userId" TEXT NOT NULL,
  "emailConnectionId" TEXT NOT NULL,

  CONSTRAINT "DomainRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DomainRule_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DomainRule_emailConnectionId_fkey" FOREIGN KEY ("emailConnectionId")
    REFERENCES "EmailConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS
  "DomainRule_emailConnectionId_pattern_includeSubdomains_key"
  ON "DomainRule" ("emailConnectionId", "pattern", "includeSubdomains");

CREATE INDEX IF NOT EXISTS "DomainRule_emailConnectionId_idx"
  ON "DomainRule" ("emailConnectionId");

-- Provenance: which rule auto-decided a sender (nulled when rule is deleted).
ALTER TABLE "Sender"
  ADD COLUMN IF NOT EXISTS "decidedByRuleId" TEXT;

CREATE INDEX IF NOT EXISTS "Sender_decidedByRuleId_idx"
  ON "Sender" ("decidedByRuleId");
