-- Contact groups attached to a draft (kurir-ios#333): a JSON list of
-- { groupId, target, removedEmails }, so a reopened draft keeps its group
-- chips instead of the members' loose addresses. Existing drafts have none.
-- Idempotent: the ADD COLUMN is a no-op once applied.

ALTER TABLE "Draft" ADD COLUMN IF NOT EXISTS "groups" JSONB NOT NULL DEFAULT '[]';
