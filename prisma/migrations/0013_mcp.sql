-- MCP remote HTTP: OAuth codes, access/refresh tokens, MRTR confirmations.
-- Idempotent: safe to re-run on instances created via prisma db push.
-- Applied by scripts/apply-migrations.sh (do not prisma db push for this).

-- 1. McpAuthorizationCode (short-lived OAuth codes, stored hashed)
CREATE TABLE IF NOT EXISTS "McpAuthorizationCode" (
  "id"            TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "codeHash"      TEXT NOT NULL,
  "clientId"      TEXT NOT NULL,
  "redirectUri"   TEXT NOT NULL,
  "codeChallenge" TEXT NOT NULL,
  "resource"      TEXT NOT NULL,
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  "userId"        TEXT NOT NULL,
  CONSTRAINT "McpAuthorizationCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "McpAuthorizationCode_codeHash_key"
  ON "McpAuthorizationCode" ("codeHash");
CREATE INDEX IF NOT EXISTS "McpAuthorizationCode_userId_idx"
  ON "McpAuthorizationCode" ("userId");

-- 2. McpToken (opaque access/refresh pair, stored hashed; audience on row)
CREATE TABLE IF NOT EXISTS "McpToken" (
  "id"                   TEXT NOT NULL,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clientId"             TEXT NOT NULL,
  "clientName"           TEXT,
  "accessTokenHash"      TEXT NOT NULL,
  "refreshTokenHash"     TEXT NOT NULL,
  "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "resource"             TEXT NOT NULL,
  "lastUsedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId"               TEXT NOT NULL,
  CONSTRAINT "McpToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "McpToken_accessTokenHash_key"
  ON "McpToken" ("accessTokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "McpToken_refreshTokenHash_key"
  ON "McpToken" ("refreshTokenHash");
CREATE INDEX IF NOT EXISTS "McpToken_userId_idx"
  ON "McpToken" ("userId");

-- 3. McpConfirmation (MRTR handles; cascades from McpToken on revoke)
CREATE TABLE IF NOT EXISTS "McpConfirmation" (
  "id"         TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "toolName"   TEXT NOT NULL,
  "argsHash"   TEXT NOT NULL,
  "argsJson"   JSONB NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "userId"     TEXT NOT NULL,
  "tokenId"    TEXT NOT NULL,
  CONSTRAINT "McpConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "McpConfirmation_userId_idx"
  ON "McpConfirmation" ("userId");
CREATE INDEX IF NOT EXISTS "McpConfirmation_tokenId_idx"
  ON "McpConfirmation" ("tokenId");

-- 4. Foreign keys (cascade on user/token deletion)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpAuthorizationCode_userId_fkey') THEN
    ALTER TABLE "McpAuthorizationCode"
      ADD CONSTRAINT "McpAuthorizationCode_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpToken_userId_fkey') THEN
    ALTER TABLE "McpToken"
      ADD CONSTRAINT "McpToken_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpConfirmation_userId_fkey') THEN
    ALTER TABLE "McpConfirmation"
      ADD CONSTRAINT "McpConfirmation_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpConfirmation_tokenId_fkey') THEN
    ALTER TABLE "McpConfirmation"
      ADD CONSTRAINT "McpConfirmation_tokenId_fkey"
      FOREIGN KEY ("tokenId") REFERENCES "McpToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
