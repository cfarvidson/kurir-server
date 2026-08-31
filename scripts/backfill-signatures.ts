#!/usr/bin/env npx tsx
/**
 * Backfill signature details (phones, title, company) for existing senders.
 * Processes senders never scanned before (signatureExtractedAt IS NULL) over
 * their five most recent bodies. Safe to re-run; already scanned senders are
 * skipped. The app also kicks this once per user after a sync, so the script
 * is for operators who want it done now or want progress output.
 *
 * Usage:
 *   pnpm backfill-signatures user@example.com
 *   pnpm backfill-signatures --all
 */

try {
  await import("dotenv/config");
} catch {}
import { db } from "../src/lib/db";
import { backfillSignatures } from "../src/lib/mail/signature-store";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: pnpm backfill-signatures <email> | --all");
    process.exit(1);
  }

  const users = args.includes("--all")
    ? await db.user.findMany({ select: { id: true, displayName: true } })
    : await db.user.findMany({
        where: {
          emailConnections: { some: { email: { in: args, mode: "insensitive" } } },
        },
        select: { id: true, displayName: true },
      });

  if (users.length === 0) {
    console.error("No matching users.");
    process.exit(1);
  }

  for (const user of users) {
    const label = user.displayName || user.id;
    console.log(`Scanning senders for ${label}...`);
    const count = await backfillSignatures(user.id, { pauseMs: 0 });
    console.log(`  ${count} senders processed`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
