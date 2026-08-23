-- Force one full resync for calendars holding a yearly BYMONTHDAY rule.
--
-- `FREQ=YEARLY;BYMONTHDAY=3` used to expand to the 3rd of every month, so an
-- annual birthday was materialised twelve times a year. The expansion is fixed
-- in code, but stored instances are only rebuilt for events a pull actually
-- touches, and an incremental pull never touches an unchanged birthday.
-- Clearing the sync token makes the next pull exhaustive, which rebuilds every
-- instance in the calendar.
--
-- Scoped to calendars that actually hold such a rule: everything else keeps
-- its token and its cheap incremental pulls.
--
-- Idempotent: re-running sets the same column to the same value, and the only
-- cost of a redundant run is one extra full pull.
-- Applied by scripts/apply-migrations.sh.

UPDATE "Calendar" SET "syncToken" = NULL
WHERE "id" IN (
    SELECT DISTINCT "calendarId" FROM "CalendarEvent"
    WHERE "rrule" ILIKE 'FREQ=YEARLY%'
      AND "rrule" ILIKE '%BYMONTHDAY%'
      AND "rrule" NOT ILIKE '%BYMONTH=%'
      AND "rrule" NOT ILIKE '%BYWEEKNO%'
      AND "rrule" NOT ILIKE '%BYYEARDAY%'
);
