-- Available hours per weekday for the calendar's open-time count.
-- Null = never set; readers fall back to 07-21 every day, which is what the
-- calendar counted before the setting existed (src/lib/calendar/availability.ts).
-- Idempotent: the ADD COLUMN is a no-op once applied.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "calendarAvailability" JSONB;
