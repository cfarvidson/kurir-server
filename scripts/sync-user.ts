#!/usr/bin/env npx tsx
/**
 * Sync emails for a user via CLI
 *
 * Usage:
 *   pnpm sync-user user@gmail.com
 *   pnpm sync-user --all
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { syncEmailConnection } from "../src/lib/mail/sync-service";

const db = new PrismaClient();

async function syncConnection(connectionId: string, email: string) {
  console.log(`\n📬 Syncing ${email}...`);

  const result = await syncEmailConnection(connectionId, { batchSize: 100 });

  if (!result.success) {
    console.error(`  ❌ Failed: ${result.error}`);
    return;
  }

  for (const r of result.results) {
    console.log(
      `  ${r.folderId}: ${r.newMessages} new (${r.totalCached}/${r.totalOnServer} cached)`
    );
    if (r.errors.length > 0) {
      for (const err of r.errors) {
        console.error(`    ⚠ ${err}`);
      }
    }
  }

  const total = result.results.reduce((sum, r) => sum + r.newMessages, 0);
  console.log(`  ✅ Synced ${total} new messages for ${email}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--all")) {
    const connections = await db.emailConnection.findMany({
      select: { id: true, email: true },
    });

    if (connections.length === 0) {
      console.log("No email connections found. Add one with: pnpm add-user");
      return;
    }

    for (const conn of connections) {
      await syncConnection(conn.id, conn.email);
    }
  } else if (args[0]) {
    const email = args[0];
    const connection = await db.emailConnection.findFirst({
      where: { email },
      select: { id: true, email: true },
    });

    if (!connection) {
      console.error(`No email connection found for: ${email}`);
      process.exit(1);
    }

    await syncConnection(connection.id, connection.email);
  } else {
    console.log("Usage:");
    console.log("  pnpm sync-user <email>    Sync a specific email connection");
    console.log("  pnpm sync-user --all      Sync all email connections");
  }

  await db.$disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
