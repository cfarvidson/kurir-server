-- The account timezone was an unreachable column: the schema defaulted it
-- to 'UTC', the register flow never set it, and no screen could change it,
-- so every 'UTC' row is the untouched default and not a choice (issue #37).
-- Make the column nullable with no default (null = never chosen) and clear
-- the default rows; the mail layout adopts the browser's reported zone on
-- the next authenticated visit, and Settings can set any IANA zone from
-- then on - including an explicit 'UTC'.
-- Idempotent: both ALTERs are no-ops once applied, and the UPDATE only
-- matches rows still carrying the old default.

ALTER TABLE "User" ALTER COLUMN "timezone" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "timezone" DROP NOT NULL;
UPDATE "User" SET "timezone" = NULL WHERE "timezone" = 'UTC';
