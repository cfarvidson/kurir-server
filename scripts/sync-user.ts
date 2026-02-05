#!/usr/bin/env npx tsx
/**
 * Sync emails for a user via CLI
 *
 * Usage:
 *   pnpm sync-user user@gmail.com
 *   pnpm sync-user --all
 */

import { PrismaClient } from "@prisma/client";
import { createDecipheriv, scryptSync } from "crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const db = new PrismaClient();

function decrypt(encryptedText: string): string {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }

  const key = scryptSync(secret, "kurir-salt", 32);
  const parts = encryptedText.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format");
  }

  const [ivBase64, authTagBase64, encrypted] = parts;
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

function extractDomain(email: string): string {
  return email.split("@")[1] || email;
}

function createSnippet(text: string | undefined, maxLength = 150): string | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").replace(/^[\s>]+/gm, "").trim();
  return cleaned.length > maxLength ? cleaned.substring(0, maxLength) + "..." : cleaned;
}

async function syncUser(userId: string, email: string) {
  console.log(`\n📬 Syncing ${email}...`);

  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    console.error(`User not found: ${userId}`);
    return;
  }

  const password = decrypt(user.encryptedPassword);

  const client = new ImapFlow({
    host: user.imapHost,
    port: user.imapPort,
    secure: true,
    auth: { user: user.email, pass: password },
    logger: false,
  });

  try {
    await client.connect();
    console.log("Connected to IMAP server");

    // Get or create INBOX folder
    let folder = await db.folder.findFirst({
      where: { userId, path: "INBOX" },
    });

    if (!folder) {
      folder = await db.folder.create({
        data: {
          userId,
          name: "INBOX",
          path: "INBOX",
          specialUse: "inbox",
        },
      });
    }

    const lock = await client.getMailboxLock("INBOX");

    try {
      // Get existing UIDs
      const existingMessages = await db.message.findMany({
        where: { folderId: folder.id },
        select: { uid: true },
      });
      const existingUids = new Set(existingMessages.map((m) => m.uid));

      // Search for all UIDs
      const searchResult = await client.search({ all: true }, { uid: true });
      const allUids: number[] = searchResult === false ? [] : searchResult;

      // Find new UIDs
      const newUids = allUids.filter((uid: number) => !existingUids.has(uid));

      console.log(`Found ${allUids.length} messages, ${newUids.length} new`);

      if (newUids.length === 0) {
        console.log("No new messages to sync");
        return;
      }

      // Fetch new messages
      const sortedNewUids = newUids.sort((a: number, b: number) => b - a).slice(0, 100); // Limit to 100

      let synced = 0;
      for await (const msg of client.fetch(sortedNewUids.join(","), {
        uid: true,
        envelope: true,
        flags: true,
        source: true,
      })) {
        try {
          const envelope = msg.envelope;
          const flags = msg.flags;

          if (!envelope || !msg.source) continue;

          const parsed = await simpleParser(msg.source);

          const fromHeader = envelope.from?.[0];
          const fromAddress = fromHeader?.address?.toLowerCase() || "unknown@unknown.com";
          const fromName = fromHeader?.name || null;

          // Get or create sender
          const sender = await db.sender.upsert({
            where: { userId_email: { userId, email: fromAddress } },
            create: {
              userId,
              email: fromAddress,
              displayName: fromName,
              domain: extractDomain(fromAddress),
              status: "PENDING",
              category: "IMBOX",
              messageCount: 1,
            },
            update: {
              displayName: fromName || undefined,
              messageCount: { increment: 1 },
            },
          });

          const isInScreener = sender.status === "PENDING";
          const isInImbox = sender.status === "APPROVED" && sender.category === "IMBOX";
          const isInFeed = sender.status === "APPROVED" && sender.category === "FEED";
          const isInPaperTrail = sender.status === "APPROVED" && sender.category === "PAPER_TRAIL";

          await db.message.create({
            data: {
              uid: msg.uid,
              messageId: envelope.messageId || null,
              threadId: envelope.messageId || null,
              inReplyTo: envelope.inReplyTo || null,
              subject: envelope.subject || null,
              fromAddress,
              fromName,
              toAddresses: envelope.to?.map((a) => a.address || "").filter(Boolean) || [],
              ccAddresses: envelope.cc?.map((a) => a.address || "").filter(Boolean) || [],
              sentAt: envelope.date || null,
              receivedAt: msg.internalDate || new Date(),
              textBody: parsed.text || null,
              htmlBody: parsed.html || null,
              snippet: createSnippet(parsed.text),
              isRead: flags?.has("\\Seen") ?? false,
              isFlagged: flags?.has("\\Flagged") ?? false,
              isDraft: flags?.has("\\Draft") ?? false,
              isDeleted: flags?.has("\\Deleted") ?? false,
              isAnswered: flags?.has("\\Answered") ?? false,
              size: msg.size || null,
              hasAttachments: (parsed.attachments?.length || 0) > 0,
              isInScreener,
              isInImbox,
              isInFeed,
              isInPaperTrail,
              folderId: folder.id,
              userId,
              senderId: sender.id,
            },
          });

          synced++;
          process.stdout.write(`\rSynced ${synced}/${sortedNewUids.length} messages`);
        } catch (err) {
          console.error(`\nFailed to sync message ${msg.uid}:`, err);
        }
      }

      console.log(`\n✅ Synced ${synced} messages for ${email}`);
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (error) {
    console.error(`Failed to sync ${email}:`, error);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--all")) {
    const users = await db.user.findMany({
      select: { id: true, email: true },
    });

    if (users.length === 0) {
      console.log("No users found. Add one with: pnpm add-user");
      return;
    }

    for (const user of users) {
      await syncUser(user.id, user.email);
    }
  } else if (args[0]) {
    const email = args[0];
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });

    if (!user) {
      console.error(`User not found: ${email}`);
      process.exit(1);
    }

    await syncUser(user.id, user.email);
  } else {
    console.log("Usage:");
    console.log("  pnpm sync-user <email>    Sync a specific user");
    console.log("  pnpm sync-user --all      Sync all users");
  }

  await db.$disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
