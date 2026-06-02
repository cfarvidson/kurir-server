-- Contact Groups: reusable recipient sets referencing ContactEmail.
-- Apply in production via:
--   bin/deploy app exec --reuse "psql \"$DATABASE_URL\" -f - < prisma/migrations/contact_groups.sql"
-- or pipe the file contents. Idempotent (IF NOT EXISTS guards).

-- 1. Enum for the group's default expansion target
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GroupTarget') THEN
    CREATE TYPE "GroupTarget" AS ENUM ('TO', 'BCC');
  END IF;
END $$;

-- 2. ContactGroup table
CREATE TABLE IF NOT EXISTS "ContactGroup" (
  "id"            TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "name"          TEXT NOT NULL,
  "defaultTarget" "GroupTarget" NOT NULL DEFAULT 'TO',
  "userId"        TEXT NOT NULL,
  CONSTRAINT "ContactGroup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ContactGroup_userId_idx" ON "ContactGroup" ("userId");

-- 3. ContactGroupMember join table (pins a ContactEmail)
CREATE TABLE IF NOT EXISTS "ContactGroupMember" (
  "id"             TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "groupId"        TEXT NOT NULL,
  "contactEmailId" TEXT NOT NULL,
  CONSTRAINT "ContactGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContactGroupMember_groupId_contactEmailId_key"
  ON "ContactGroupMember" ("groupId", "contactEmailId");
CREATE INDEX IF NOT EXISTS "ContactGroupMember_groupId_idx"
  ON "ContactGroupMember" ("groupId");
CREATE INDEX IF NOT EXISTS "ContactGroupMember_contactEmailId_idx"
  ON "ContactGroupMember" ("contactEmailId");

-- 4. Foreign keys (cascade on owner/contact deletion)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContactGroup_userId_fkey') THEN
    ALTER TABLE "ContactGroup"
      ADD CONSTRAINT "ContactGroup_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContactGroupMember_groupId_fkey') THEN
    ALTER TABLE "ContactGroupMember"
      ADD CONSTRAINT "ContactGroupMember_groupId_fkey"
      FOREIGN KEY ("groupId") REFERENCES "ContactGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContactGroupMember_contactEmailId_fkey') THEN
    ALTER TABLE "ContactGroupMember"
      ADD CONSTRAINT "ContactGroupMember_contactEmailId_fkey"
      FOREIGN KEY ("contactEmailId") REFERENCES "ContactEmail"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
