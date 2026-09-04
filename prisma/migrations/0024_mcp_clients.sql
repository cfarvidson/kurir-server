-- Admin-registered MCP OAuth clients (public clients, PKCE, no secret) for
-- hosts that cannot serve a Client ID Metadata Document. Idempotent.

CREATE TABLE IF NOT EXISTS "McpClient" (
  "id"           TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clientId"     TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "redirectUris" TEXT[],
  "createdBy"    TEXT NOT NULL,
  CONSTRAINT "McpClient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "McpClient_clientId_key"
  ON "McpClient" ("clientId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpClient_createdBy_fkey') THEN
    ALTER TABLE "McpClient"
      ADD CONSTRAINT "McpClient_createdBy_fkey"
      FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
