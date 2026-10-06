-- Travel time on calendar events, read from and written back to Apple
-- Calendar's X-APPLE-TRAVEL-DURATION / X-APPLE-TRAVEL-* lines over CalDAV.
-- Null minutes = no travel time.
-- Idempotent: each ADD COLUMN is a no-op once applied.

ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "travelMinutes" INTEGER;
ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "travelExtra" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Events already in the replica were read before Kurir knew these lines,
-- and an incremental pull only re-reads what changed (a CalDAV sync token,
-- an ICS feed's ETag). Forgetting the token makes the next sync read every
-- resource again, through the same path as a first sync, so travel time
-- set in Apple Calendar shows without waiting for each event to change.
-- Running this twice only costs one more full pull.
UPDATE "Calendar" SET "syncToken" = NULL
WHERE "syncToken" IS NOT NULL
  AND "accountId" IN (
    SELECT "id" FROM "CalendarAccount" WHERE "provider" IN ('CALDAV', 'ICS')
  );
