-- Per-token APNs environment: remembers which gateway (sandbox/production)
-- last accepted the token. Dev builds carry sandbox tokens while TestFlight/
-- App Store builds carry production tokens, so a single APNS_SANDBOX setting
-- cannot serve a mixed device fleet.
-- Run with: bin/deploy app exec --reuse "psql \"\$DATABASE_URL\" -f -" < prisma/migrations/apns_env.sql
-- (or pipe via docker compose exec -T postgres psql -U kurir < prisma/migrations/apns_env.sql in dev)

ALTER TABLE "PushSubscription"
  ADD COLUMN IF NOT EXISTS "apnsEnv" text;
