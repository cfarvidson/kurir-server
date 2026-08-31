-- Person profile from signatures (kurir-ios#116): phones, job title, and
-- company lifted from a sender's signature blocks, stored per Sender.
-- signatureExtractedAt is null until the sender has been scanned once, which
-- is what the backfill (scripts/backfill-signatures.ts and the post-sync kick)
-- uses to find remaining work. Idempotent: every ADD COLUMN is guarded.

ALTER TABLE "Sender" ADD COLUMN IF NOT EXISTS "signaturePhones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Sender" ADD COLUMN IF NOT EXISTS "signatureTitle" TEXT;
ALTER TABLE "Sender" ADD COLUMN IF NOT EXISTS "signatureCompany" TEXT;
ALTER TABLE "Sender" ADD COLUMN IF NOT EXISTS "signatureExtractedAt" TIMESTAMP(3);
