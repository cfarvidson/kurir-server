-- Search on addresses, and on Swedish text without English stemming.
--
-- The 0001 vector held subject, fromName and the body only, so typing an
-- address (or a name that only appears in the address) found nothing, and
-- the 'english' configuration stemmed Swedish words unpredictably
-- ("fakturan" no longer prefix-matched "faktura"; "in", "the" vanished).
-- Now: 'simple' (no stemming, no stop words) everywhere, and the From /
-- To / Cc addresses indexed both whole ("monika@kultur.se") and split on
-- @ and . ("monika kultur se") so a bare name, a domain or a full address
-- all hit. searchMessages must query with the same 'simple' configuration.
--
-- Idempotent: CREATE OR REPLACE + DROP/CREATE trigger, and the backfill
-- recomputes every row (a second run just recomputes again). The raw
-- UPDATE does not touch updatedAt (Prisma sets it client-side), so the
-- apps do not re-sync the whole mailbox.

CREATE OR REPLACE FUNCTION message_search_vector_update() RETURNS trigger AS $$
DECLARE
  addresses text;
BEGIN
  addresses := concat_ws(' ',
    NEW."fromAddress",
    array_to_string(NEW."toAddresses", ' '),
    array_to_string(NEW."ccAddresses", ' ')
  );
  NEW.search_vector :=
    setweight(to_tsvector('simple', COALESCE(NEW.subject, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW."fromName", '')), 'B') ||
    setweight(to_tsvector('simple', addresses), 'B') ||
    setweight(to_tsvector('simple', regexp_replace(addresses, '[@.]', ' ', 'g')), 'B') ||
    setweight(to_tsvector('simple', left(
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

DROP TRIGGER IF EXISTS message_search_vector_trigger ON "Message";
CREATE TRIGGER message_search_vector_trigger
  BEFORE INSERT OR UPDATE OF subject, "textBody", "htmlBody", "fromName",
    "fromAddress", "toAddresses", "ccAddresses"
  ON "Message"
  FOR EACH ROW
  EXECUTE FUNCTION message_search_vector_update();

-- Recompute every existing row in batches, walking the primary key so
-- each batch is a cheap index range scan.
DO $$
DECLARE
  last_id text := '';
  batch_count integer;
BEGIN
  LOOP
    WITH batch AS (
      SELECT id FROM "Message" WHERE id > last_id ORDER BY id LIMIT 1000
    ), done AS (
      UPDATE "Message" m SET subject = m.subject
      FROM batch WHERE m.id = batch.id
      RETURNING m.id
    )
    SELECT count(*), max(id) INTO batch_count, last_id FROM done;
    EXIT WHEN batch_count = 0;
    RAISE NOTICE 'Reindexed % messages (through %)', batch_count, last_id;
  END LOOP;
END $$;
