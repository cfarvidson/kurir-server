-- The mobile sync now carries each message's AI rule verdict (aiVerdict),
-- but it is cursored on Message.updatedAt and verdicts stored before this
-- release never touched the message. Bump every judged message once so
-- the apps receive the verdicts they already have. Safe to re-run: a
-- second run only makes the apps re-sync those rows again.

UPDATE "Message"
SET "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT DISTINCT "messageId" FROM "ContentRuleMatch");
