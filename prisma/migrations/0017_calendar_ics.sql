-- Fourth calendar provider: public ICS URL subscriptions.
-- Idempotent: ADD VALUE throws duplicate_object if ICS is already present.

DO $$ BEGIN
  ALTER TYPE "CalendarProvider" ADD VALUE 'ICS';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
