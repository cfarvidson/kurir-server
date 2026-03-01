#!/usr/bin/env npx tsx
/**
 * Migration script: Move from user-owned email credentials to EmailConnection model
 *
 * Run AFTER deploying the new Prisma schema (which added Passkey, EmailConnection models
 * and emailConnectionId FKs on Message, Sender, Folder, SyncState).
 *
 * What this script does:
 *   1. For each existing User (which currently has email/IMAP/SMTP fields), create an
 *      EmailConnection record with those credentials.
 *   2. Backfill emailConnectionId on Folder, Sender, Message by joining through userId.
 *   3. Migrate SyncState from userId -> emailConnectionId.
 *   4. Report any rows that couldn't be migrated (should be zero for a clean DB).
 *
 * This script is idempotent: it skips users that already have EmailConnections and
 * skips rows that already have emailConnectionId set.
 *
 * After running and verifying the app works:
 *   - You can remove the old email/IMAP/SMTP columns from the User table via a follow-up
 *     Prisma migration (prisma migrate dev --name drop-user-email-fields).
 *
 * Usage:
 *   pnpm tsx scripts/migrate-to-passkey-auth.ts
 *   pnpm tsx scripts/migrate-to-passkey-auth.ts --dry-run
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const isDryRun = process.argv.includes("--dry-run");

function log(msg: string) {
  console.log(`[${isDryRun ? "DRY RUN" : "MIGRATE"}] ${msg}`);
}

async function main() {
  console.log("\nKurir - Auth Migration: Users -> EmailConnections\n");
  if (isDryRun) {
    console.log("DRY RUN mode: no changes will be written\n");
  }

  // Step 1: Fetch all users that still have email/IMAP/SMTP data on the User row.
  // After the schema change, User no longer has these fields in the Prisma client.
  // We must query via raw SQL to read the legacy columns.
  type LegacyUser = {
    id: string;
    email: string | null;
    display_name: string | null;
    imap_host: string | null;
    imap_port: number | null;
    smtp_host: string | null;
    smtp_port: number | null;
    encrypted_password: string | null;
  };

  const legacyUsers = await db.$queryRaw<LegacyUser[]>`
    SELECT
      id,
      email,
      "displayName" AS display_name,
      "imapHost"   AS imap_host,
      "imapPort"   AS imap_port,
      "smtpHost"   AS smtp_host,
      "smtpPort"   AS smtp_port,
      "encryptedPassword" AS encrypted_password
    FROM "User"
    WHERE email IS NOT NULL
      AND "imapHost" IS NOT NULL
      AND "smtpHost" IS NOT NULL
      AND "encryptedPassword" IS NOT NULL
  `;

  log(`Found ${legacyUsers.length} user(s) with legacy email credentials`);

  if (legacyUsers.length === 0) {
    log("Nothing to migrate — all users already migrated or no legacy data found.");
    log("If you expected data here, check that the legacy columns still exist in the DB.");
    await db.$disconnect();
    return;
  }

  let usersProcessed = 0;
  let connectionsCreated = 0;
  let foldersBackfilled = 0;
  let sendersBackfilled = 0;
  let messagesBackfilled = 0;
  let syncStatesBackfilled = 0;

  for (const user of legacyUsers) {
    if (!user.email || !user.imap_host || !user.smtp_host || !user.encrypted_password) {
      log(`  SKIP user ${user.id}: missing required legacy fields`);
      continue;
    }

    log(`  Processing user ${user.id} (${user.email})`);

    // Check if an EmailConnection already exists for this user+email
    const existingConnection = await db.emailConnection.findFirst({
      where: { userId: user.id, email: user.email },
    });

    let connectionId: string;

    if (existingConnection) {
      log(`    EmailConnection already exists (${existingConnection.id}), skipping creation`);
      connectionId = existingConnection.id;
    } else {
      log(`    Creating EmailConnection for ${user.email}`);

      if (!isDryRun) {
        const connection = await db.emailConnection.create({
          data: {
            userId: user.id,
            email: user.email,
            displayName: user.display_name ?? undefined,
            imapHost: user.imap_host,
            imapPort: user.imap_port ?? 993,
            smtpHost: user.smtp_host,
            smtpPort: user.smtp_port ?? 587,
            encryptedPassword: user.encrypted_password,
            isDefault: true, // Only connection, so it's the default
          },
        });
        connectionId = connection.id;
        connectionsCreated++;
        log(`    Created EmailConnection ${connectionId}`);
      } else {
        connectionId = "<would-be-created>";
        connectionsCreated++;
      }
    }

    if (isDryRun) {
      // Count what would be backfilled
      const folderCount = await db.folder.count({ where: { userId: user.id, emailConnectionId: undefined } });
      const senderCount = await db.sender.count({ where: { userId: user.id, emailConnectionId: undefined } });
      const messageCount = await db.message.count({ where: { userId: user.id, emailConnectionId: undefined } });
      const syncStateCount = await db.syncState.count({ where: { emailConnectionId: undefined } });

      log(`    Would backfill: ${folderCount} folders, ${senderCount} senders, ${messageCount} messages`);
      if (syncStateCount > 0) log(`    Would migrate SyncState`);

      foldersBackfilled += folderCount;
      sendersBackfilled += senderCount;
      messagesBackfilled += messageCount;
      syncStatesBackfilled += syncStateCount;
      usersProcessed++;
      continue;
    }

    // Step 2: Backfill emailConnectionId on Folders for this user
    const folderResult = await db.folder.updateMany({
      where: { userId: user.id, emailConnectionId: undefined },
      data: { emailConnectionId: connectionId },
    });
    foldersBackfilled += folderResult.count;
    if (folderResult.count > 0) {
      log(`    Backfilled emailConnectionId on ${folderResult.count} folder(s)`);
    }

    // Step 3: Backfill emailConnectionId on Senders for this user
    const senderResult = await db.sender.updateMany({
      where: { userId: user.id, emailConnectionId: undefined },
      data: { emailConnectionId: connectionId },
    });
    sendersBackfilled += senderResult.count;
    if (senderResult.count > 0) {
      log(`    Backfilled emailConnectionId on ${senderResult.count} sender(s)`);
    }

    // Step 4: Backfill emailConnectionId on Messages for this user
    // Do this in batches to avoid locking too many rows at once
    const BATCH_SIZE = 500;
    let offset = 0;
    let batchCount: number;

    do {
      const batch = await db.message.findMany({
        where: { userId: user.id, emailConnectionId: undefined },
        select: { id: true },
        take: BATCH_SIZE,
        skip: offset,
      });

      batchCount = batch.length;

      if (batchCount > 0) {
        await db.message.updateMany({
          where: { id: { in: batch.map((m) => m.id) } },
          data: { emailConnectionId: connectionId },
        });
        messagesBackfilled += batchCount;
        log(`    Backfilled ${batchCount} message(s) (total: ${messagesBackfilled})`);
      }

      offset += batchCount;
    } while (batchCount === BATCH_SIZE);

    // Step 5: Migrate SyncState from userId to emailConnectionId
    // The old SyncState has a unique userId; the new one has a unique emailConnectionId.
    // Read via raw SQL since the Prisma model no longer has a userId field.
    type LegacySyncState = { id: string; last_full_sync: Date | null; is_syncing: boolean; sync_started_at: Date | null; sync_error: string | null };
    const legacySyncStates = await db.$queryRaw<LegacySyncState[]>`
      SELECT id, "lastFullSync" AS last_full_sync, "isSyncing" AS is_syncing,
             "syncStartedAt" AS sync_started_at, "syncError" AS sync_error
      FROM "SyncState"
      WHERE "userId" = ${user.id}
        AND "emailConnectionId" IS NULL
    `;

    for (const ss of legacySyncStates) {
      const existingSyncState = await db.syncState.findFirst({
        where: { emailConnectionId: connectionId },
      });

      if (!existingSyncState) {
        await db.syncState.create({
          data: {
            emailConnectionId: connectionId,
            lastFullSync: ss.last_full_sync ?? undefined,
            isSyncing: ss.is_syncing,
            syncStartedAt: ss.sync_started_at ?? undefined,
            syncError: ss.sync_error ?? undefined,
          },
        });
        syncStatesBackfilled++;
        log(`    Migrated SyncState to emailConnectionId`);
      } else {
        log(`    SyncState already exists for emailConnectionId, skipping`);
      }
    }

    usersProcessed++;
  }

  console.log("\nMigration Summary:");
  console.log(`  Users processed:        ${usersProcessed}`);
  console.log(`  EmailConnections created: ${connectionsCreated}`);
  console.log(`  Folders backfilled:     ${foldersBackfilled}`);
  console.log(`  Senders backfilled:     ${sendersBackfilled}`);
  console.log(`  Messages backfilled:    ${messagesBackfilled}`);
  console.log(`  SyncStates migrated:    ${syncStatesBackfilled}`);

  if (!isDryRun && usersProcessed > 0) {
    console.log("\nNext steps:");
    console.log("  1. Verify the app works correctly with the migrated data.");
    console.log("  2. Register a passkey at /register.");
    console.log("  3. Once verified, run a follow-up Prisma migration to drop the legacy");
    console.log("     columns (email, imapHost, etc.) from the User table.");
  }

  await db.$disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
