-- Travel time after a calendar event: Kurir's own X-KURIR-TRAVEL-AFTER line
-- on the VEVENT (Apple Calendar has no such field). Null = none.
-- No re-sync: only Kurir writes this line, and no Kurir wrote it before.
-- Idempotent: the ADD COLUMN is a no-op once applied.

ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "travelAfterMinutes" INTEGER;
