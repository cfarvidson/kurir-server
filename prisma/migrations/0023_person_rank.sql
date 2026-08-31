-- Materialised Rank (kurir-ios#117): one row per counterpart of the user
-- (every non-own address seen in From/To/Cc/Bcc), with the Rank score from
-- src/lib/mail/person-stats.ts. Filled for the whole mailbox after each
-- completed sync and by scripts/recompute-rank.ts; position is derived as
-- ORDER BY score DESC, email ASC. Idempotent: guarded CREATEs only.

CREATE TABLE IF NOT EXISTS "PersonRank" (
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "displayName" TEXT,
  "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "computedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PersonRank_pkey" PRIMARY KEY ("userId", "email"),
  CONSTRAINT "PersonRank_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PersonRank_userId_score_idx"
  ON "PersonRank" ("userId", "score" DESC);

CREATE INDEX IF NOT EXISTS "PersonRank_userId_domain_idx"
  ON "PersonRank" ("userId", "domain");
