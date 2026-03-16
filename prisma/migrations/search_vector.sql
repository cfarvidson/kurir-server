-- Add full-text search support to Message table
-- Run with: docker compose exec -T postgres psql -U kurir < prisma/migrations/search_vector.sql

-- 1. Add tsvector column
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;

-- 2. Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS "Message_search_vector_idx"
  ON "Message" USING GIN ("search_vector");

-- 3. Trigger function to auto-compute search vector on INSERT/UPDATE
CREATE OR REPLACE FUNCTION message_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.subject, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW."fromName", '')), 'B') ||
    setweight(to_tsvector('english', left(
      CASE
        WHEN NEW."textBody" IS NOT NULL AND NEW."textBody" != ''
          THEN NEW."textBody"
        WHEN NEW."htmlBody" IS NOT NULL
          THEN regexp_replace(NEW."htmlBody", '<[^>]+>', ' ', 'g')
        ELSE ''
      END
    , 500000)), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- 4. Create trigger (drop first if it already exists to allow re-running)
DROP TRIGGER IF EXISTS message_search_vector_trigger ON "Message";
CREATE TRIGGER message_search_vector_trigger
  BEFORE INSERT OR UPDATE OF subject, "textBody", "htmlBody", "fromName"
  ON "Message"
  FOR EACH ROW
  EXECUTE FUNCTION message_search_vector_update();

-- 5. Backfill existing messages in batches of 1000
-- This UPDATE will be triggered repeatedly by the backfill loop below.
-- For manual execution, run this statement repeatedly until 0 rows affected:
DO $$
DECLARE
  batch_count integer;
BEGIN
  LOOP
    UPDATE "Message" SET subject = subject
    WHERE id IN (
      SELECT id FROM "Message" WHERE "search_vector" IS NULL LIMIT 1000
    );
    GET DIAGNOSTICS batch_count = ROW_COUNT;
    RAISE NOTICE 'Backfilled % messages', batch_count;
    EXIT WHEN batch_count = 0;
  END LOOP;
END $$;
