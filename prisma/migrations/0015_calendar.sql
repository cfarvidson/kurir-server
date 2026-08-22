-- Calendar replica: accounts, calendars, events, instances, meeting invites, tombstones.
-- Idempotent: safe to re-run on instances created via prisma db push.
-- Applied by scripts/apply-migrations.sh.

DO $$ BEGIN CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE', 'MICROSOFT', 'CALDAV'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1. CalendarAccount (one connected Google / Microsoft / CalDAV source)
CREATE TABLE IF NOT EXISTS "CalendarAccount" (
  "id"                  TEXT NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  "provider"            "CalendarProvider" NOT NULL,
  "displayName"         TEXT NOT NULL,
  "principalEmail"      TEXT,
  "emailConnectionId"   TEXT,
  "oauthAccessToken"    TEXT,
  "oauthRefreshToken"   TEXT,
  "oauthTokenExpiresAt" TIMESTAMP(3),
  "oauthError"          TEXT,
  "caldavUrl"           TEXT,
  "caldavUsername"      TEXT,
  "encryptedPassword"   TEXT,
  "isSyncing"           BOOLEAN NOT NULL DEFAULT false,
  "syncLockToken"       TEXT,
  "syncLockAt"          TIMESTAMP(3),
  "lastSyncedAt"        TIMESTAMP(3),
  "lastError"           TEXT,
  "userId"              TEXT NOT NULL,
  CONSTRAINT "CalendarAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CalendarAccount_userId_idx"
  ON "CalendarAccount" ("userId");
CREATE INDEX IF NOT EXISTS "CalendarAccount_emailConnectionId_idx"
  ON "CalendarAccount" ("emailConnectionId");

-- 2. Calendar (one calendar inside an account)
CREATE TABLE IF NOT EXISTS "Calendar" (
  "id"                 TEXT NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  "providerCalendarId" TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "color"              TEXT,
  "isVisible"          BOOLEAN NOT NULL DEFAULT true,
  "isPrimary"          BOOLEAN NOT NULL DEFAULT false,
  "isReadOnly"         BOOLEAN NOT NULL DEFAULT false,
  "timezone"           TEXT,
  "syncToken"          TEXT,
  "ctag"               TEXT,
  "lastError"          TEXT,
  "accountId"          TEXT NOT NULL,
  "userId"             TEXT NOT NULL,
  CONSTRAINT "Calendar_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Calendar_accountId_providerCalendarId_key"
  ON "Calendar" ("accountId", "providerCalendarId");
CREATE INDEX IF NOT EXISTS "Calendar_userId_idx"
  ON "Calendar" ("userId");

-- 3. CalendarEvent (master or exception, not an expanded occurrence)
CREATE TABLE IF NOT EXISTS "CalendarEvent" (
  "id"              TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "icalUid"         TEXT,
  "etag"            TEXT,
  "sequence"        INTEGER NOT NULL DEFAULT 0,
  "title"           TEXT NOT NULL,
  "description"     TEXT,
  "location"        TEXT,
  "startAt"         TIMESTAMP(3) NOT NULL,
  "endAt"           TIMESTAMP(3) NOT NULL,
  "isAllDay"        BOOLEAN NOT NULL DEFAULT false,
  "timezone"        TEXT,
  "status"          TEXT NOT NULL DEFAULT 'confirmed',
  "transparency"    TEXT NOT NULL DEFAULT 'busy',
  "rrule"           TEXT,
  "rdate"           TEXT,
  "exdate"          TEXT,
  "masterEventId"   TEXT,
  "recurrenceId"    TIMESTAMP(3),
  "organizerJson"   JSONB,
  "attendeesJson"   JSONB,
  "rawJson"         JSONB,
  "calendarId"      TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CalendarEvent_calendarId_providerEventId_key"
  ON "CalendarEvent" ("calendarId", "providerEventId");
CREATE INDEX IF NOT EXISTS "CalendarEvent_userId_icalUid_idx"
  ON "CalendarEvent" ("userId", "icalUid");
CREATE INDEX IF NOT EXISTS "CalendarEvent_masterEventId_idx"
  ON "CalendarEvent" ("masterEventId");

-- 4. CalendarEventInstance (materialized occurrence in the replica window)
CREATE TABLE IF NOT EXISTS "CalendarEventInstance" (
  "id"          TEXT NOT NULL,
  "startAt"     TIMESTAMP(3) NOT NULL,
  "endAt"       TIMESTAMP(3) NOT NULL,
  "isAllDay"    BOOLEAN NOT NULL DEFAULT false,
  "isCancelled" BOOLEAN NOT NULL DEFAULT false,
  "isException" BOOLEAN NOT NULL DEFAULT false,
  "eventId"     TEXT NOT NULL,
  "calendarId"  TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  CONSTRAINT "CalendarEventInstance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CalendarEventInstance_userId_startAt_endAt_idx"
  ON "CalendarEventInstance" ("userId", "startAt", "endAt");
CREATE INDEX IF NOT EXISTS "CalendarEventInstance_eventId_idx"
  ON "CalendarEventInstance" ("eventId");
CREATE INDEX IF NOT EXISTS "CalendarEventInstance_userId_calendarId_startAt_idx"
  ON "CalendarEventInstance" ("userId", "calendarId", "startAt");

-- 5. MessageMeeting (parsed invite attached to one Message)
CREATE TABLE IF NOT EXISTS "MessageMeeting" (
  "id"              TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "uid"             TEXT NOT NULL,
  "method"          TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "startAt"         TIMESTAMP(3),
  "endAt"           TIMESTAMP(3),
  "isAllDay"        BOOLEAN NOT NULL DEFAULT false,
  "location"        TEXT,
  "organizerEmail"  TEXT,
  "organizerName"   TEXT,
  "recurrenceId"    TIMESTAMP(3),
  "calendarEventId" TEXT,
  "messageId"       TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  CONSTRAINT "MessageMeeting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MessageMeeting_messageId_key"
  ON "MessageMeeting" ("messageId");
CREATE INDEX IF NOT EXISTS "MessageMeeting_userId_idx"
  ON "MessageMeeting" ("userId");
CREATE INDEX IF NOT EXISTS "MessageMeeting_calendarEventId_idx"
  ON "MessageMeeting" ("calendarEventId");

-- 6. CalendarTombstone (deleted masters for native delta-sync; prune after 30 days)
CREATE TABLE IF NOT EXISTS "CalendarTombstone" (
  "id"              TEXT NOT NULL,
  "deletedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "eventId"         TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  CONSTRAINT "CalendarTombstone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CalendarTombstone_userId_eventId_key"
  ON "CalendarTombstone" ("userId", "eventId");
CREATE INDEX IF NOT EXISTS "CalendarTombstone_userId_deletedAt_idx"
  ON "CalendarTombstone" ("userId", "deletedAt");

-- 7. Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalendarAccount_userId_fkey') THEN
    ALTER TABLE "CalendarAccount"
      ADD CONSTRAINT "CalendarAccount_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalendarAccount_emailConnectionId_fkey') THEN
    ALTER TABLE "CalendarAccount"
      ADD CONSTRAINT "CalendarAccount_emailConnectionId_fkey"
      FOREIGN KEY ("emailConnectionId") REFERENCES "EmailConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Calendar_userId_fkey') THEN
    ALTER TABLE "Calendar"
      ADD CONSTRAINT "Calendar_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Calendar_accountId_fkey') THEN
    ALTER TABLE "Calendar"
      ADD CONSTRAINT "Calendar_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "CalendarAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalendarEvent_userId_fkey') THEN
    ALTER TABLE "CalendarEvent"
      ADD CONSTRAINT "CalendarEvent_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalendarEvent_calendarId_fkey') THEN
    ALTER TABLE "CalendarEvent"
      ADD CONSTRAINT "CalendarEvent_calendarId_fkey"
      FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalendarEvent_masterEventId_fkey') THEN
    ALTER TABLE "CalendarEvent"
      ADD CONSTRAINT "CalendarEvent_masterEventId_fkey"
      FOREIGN KEY ("masterEventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalendarEventInstance_userId_fkey') THEN
    ALTER TABLE "CalendarEventInstance"
      ADD CONSTRAINT "CalendarEventInstance_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalendarEventInstance_eventId_fkey') THEN
    ALTER TABLE "CalendarEventInstance"
      ADD CONSTRAINT "CalendarEventInstance_eventId_fkey"
      FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalendarEventInstance_calendarId_fkey') THEN
    ALTER TABLE "CalendarEventInstance"
      ADD CONSTRAINT "CalendarEventInstance_calendarId_fkey"
      FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageMeeting_userId_fkey') THEN
    ALTER TABLE "MessageMeeting"
      ADD CONSTRAINT "MessageMeeting_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageMeeting_messageId_fkey') THEN
    ALTER TABLE "MessageMeeting"
      ADD CONSTRAINT "MessageMeeting_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MessageMeeting_calendarEventId_fkey') THEN
    ALTER TABLE "MessageMeeting"
      ADD CONSTRAINT "MessageMeeting_calendarEventId_fkey"
      FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CalendarTombstone_userId_fkey') THEN
    ALTER TABLE "CalendarTombstone"
      ADD CONSTRAINT "CalendarTombstone_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
