#!/usr/bin/env npx tsx
/**
 * Recompute the materialised Rank (PersonRank table) for existing users.
 * The app does this after every completed sync; the script is for operators
 * who want it done now (right after the upgrade to kurir-ios#117, say) or
 * want the counts printed.
 *
 * Usage:
 *   pnpm recompute-rank user@example.com
 *   pnpm recompute-rank --all
 */

try {
  await import("dotenv/config");
} catch {}
import { db } from "../src/lib/db";
import { recomputePersonRank } from "../src/lib/mail/person-rank-store";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: pnpm recompute-rank <email> | --all");
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
    console.log(`Ranking people for ${label}...`);
    const count = await recomputePersonRank(user.id);
    console.log(`  ${count} people ranked`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
