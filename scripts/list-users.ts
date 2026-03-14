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
      displayName: true,
      createdAt: true,
      emailConnections: {
        select: {
          email: true,
          imapHost: true,
          smtpHost: true,
          isDefault: true,
        },
        orderBy: { isDefault: "desc" },
      },
      _count: {
        select: {
          messages: true,
          senders: true,
          passkeys: true,
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
    if (user.displayName) {
      console.log(`Name:     ${user.displayName}`);
    }
    console.log(`Passkeys: ${user._count.passkeys}`);
    console.log(`Messages: ${user._count.messages}`);
    console.log(`Senders:  ${user._count.senders}`);
    console.log(`Created:  ${user.createdAt.toISOString()}`);

    for (const conn of user.emailConnections) {
      console.log(
        `  ${conn.isDefault ? "★" : " "} ${conn.email}  IMAP: ${conn.imapHost}  SMTP: ${conn.smtpHost}`
      );
    }
  }

  console.log(`─────────────────────────────────────\n`);

  await db.$disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
