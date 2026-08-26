-- Draft generation: one encrypted subscription credential per user
-- (Claude Code setup-token or Grok Build session). Idempotent: safe to
-- re-run on instances created via prisma db push.
-- Applied by scripts/apply-migrations.sh (do not prisma db push for this).

CREATE TABLE IF NOT EXISTS "DraftGenerationCredential" (
  "id"              TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "provider"        TEXT NOT NULL,
  "encryptedSecret" TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  CONSTRAINT "DraftGenerationCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DraftGenerationCredential_userId_key"
  ON "DraftGenerationCredential" ("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DraftGenerationCredential_userId_fkey') THEN
    ALTER TABLE "DraftGenerationCredential"
      ADD CONSTRAINT "DraftGenerationCredential_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
