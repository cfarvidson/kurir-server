-- Catch-all domains (plan 032): opt-in per connection to treat every address
-- on the connection's email domain as the user's own.
-- Idempotent: the production instance and hand-repaired self-host installs
-- already have the column.
ALTER TABLE "EmailConnection"
  ADD COLUMN IF NOT EXISTS "treatDomainAsOwn" BOOLEAN NOT NULL DEFAULT false;
