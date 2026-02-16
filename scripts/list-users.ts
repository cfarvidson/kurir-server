#!/usr/bin/env npx tsx
/**
 * List all users in Kurir
 *
 * Usage:
 *   pnpm list-users
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("\n📧 Kurir Users\n");

  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      displayName: true,
      imapHost: true,
      smtpHost: true,
      createdAt: true,
      _count: {
        select: {
          messages: true,
          senders: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (users.length === 0) {
    console.log("No users found. Add one with: pnpm add-user\n");
    return;
  }

  console.log(`Found ${users.length} user(s):\n`);

  for (const user of users) {
    console.log(`─────────────────────────────────────`);
    console.log(`ID:       ${user.id}`);
    console.log(`Email:    ${user.email}`);
    if (user.displayName) {
      console.log(`Name:     ${user.displayName}`);
    }
    console.log(`IMAP:     ${user.imapHost}`);
    console.log(`SMTP:     ${user.smtpHost}`);
    console.log(`Messages: ${user._count.messages}`);
    console.log(`Senders:  ${user._count.senders}`);
    console.log(`Created:  ${user.createdAt.toISOString()}`);
  }

  console.log(`─────────────────────────────────────\n`);

  await db.$disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
