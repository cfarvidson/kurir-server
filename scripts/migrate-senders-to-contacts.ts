#!/usr/bin/env npx tsx
/**
 * Migration script: Create Contact records from approved Sender records.
 *
 * For each approved Sender, creates a Contact + ContactEmail pair so that
 * the user's existing senders are available in the new contacts system.
 *
 * The same person may have Sender records across multiple EmailConnections,
 * so we group by lowercase email + userId to avoid duplicates.
 *
 * This script is idempotent: it skips email+userId pairs that already have
 * a ContactEmail linked to the user. Safe to run multiple times.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-senders-to-contacts.ts
 *   pnpm tsx scripts/migrate-senders-to-contacts.ts --dry-run
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const isDryRun = process.argv.includes("--dry-run");

function log(msg: string) {
  console.log(`[${isDryRun ? "DRY RUN" : "MIGRATE"}] ${msg}`);
}

type ApprovedSender = {
  id: string;
  email: string;
  displayName: string | null;
  userId: string;
};

/**
 * Derive a display name from a sender record. Falls back to the local part
 * of the email address if no displayName is set.
 */
function contactName(sender: ApprovedSender): string {
  if (sender.displayName?.trim()) {
    return sender.displayName.trim();
  }
  return sender.email.split("@")[0];
}

async function main() {
  console.log("\nKurir - Sender -> Contact Migration\n");
  if (isDryRun) {
    console.log("DRY RUN mode: no changes will be written\n");
  }

  // Step 1: Fetch all approved senders
  const approvedSenders = await prisma.sender.findMany({
    where: { status: "APPROVED" },
    select: { id: true, email: true, displayName: true, userId: true },
  });

  log(`Found ${approvedSenders.length} approved sender(s)`);

  if (approvedSenders.length === 0) {
    log("Nothing to migrate.");
    return;
  }

  // Step 2: Group by lowercase email + userId to deduplicate across connections.
  // Keep a representative sender per group (prefer one with a displayName).
  const grouped = new Map<string, { senders: ApprovedSender[] }>();

  for (const sender of approvedSenders) {
    const key = `${sender.userId}::${sender.email.toLowerCase()}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.senders.push(sender);
    } else {
      grouped.set(key, { senders: [sender] });
    }
  }

  log(`Grouped into ${grouped.size} unique email+user pair(s)`);

  // Step 3: For each group, check if ContactEmail already exists, and create if not.
  let contactsCreated = 0;
  let skipped = 0;
  let errors = 0;

  for (const [key, { senders }] of grouped) {
    // Pick the best representative: prefer one with a displayName
    const representative =
      senders.find((s) => s.displayName?.trim()) ?? senders[0];
    const email = representative.email.toLowerCase();
    const userId = representative.userId;

    // Check if a ContactEmail already exists for this email and user
    const existingContactEmail = await prisma.contactEmail.findFirst({
      where: {
        email,
        contact: { userId },
      },
    });

    if (existingContactEmail) {
      skipped++;
      continue;
    }

    if (isDryRun) {
      log(
        `  Would create contact for ${email} (user ${userId}, name: "${contactName(representative)}")`,
      );
      contactsCreated++;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const contact = await tx.contact.create({
          data: {
            name: contactName(representative),
            userId,
            emails: {
              create: {
                email,
                label: "personal",
                isPrimary: true,
                senderId: representative.id,
              },
            },
          },
        });

        return contact;
      });

      contactsCreated++;
    } catch (err) {
      errors++;
      log(
        `  ERROR migrating ${key}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log("\nMigration Summary:");
  console.log(`  Approved senders found: ${approvedSenders.length}`);
  console.log(`  Unique email+user pairs: ${grouped.size}`);
  console.log(`  Contacts created:       ${contactsCreated}`);
  console.log(`  Skipped (already exist): ${skipped}`);
  if (errors > 0) {
    console.log(`  Errors:                 ${errors}`);
  }

  if (!isDryRun && contactsCreated > 0) {
    console.log(
      `\nMigrated ${approvedSenders.length} sender(s) into ${contactsCreated} contact(s).`,
    );
  }
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
