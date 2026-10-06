-- Travel time on calendar events, read from and written back to Apple
-- Calendar's X-APPLE-TRAVEL-DURATION / X-APPLE-TRAVEL-* lines over CalDAV.
-- Null minutes = no travel time; existing rows get none until their next pull.
-- Idempotent: each ADD COLUMN is a no-op once applied.

ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "travelMinutes" INTEGER;
ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "travelExtra" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
