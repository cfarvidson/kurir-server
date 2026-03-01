#!/usr/bin/env npx tsx
/**
 * Add a user and email connection to Kurir via CLI
 *
 * In the new auth system, a "user" is just an identity (no email on User).
 * Email credentials live on EmailConnection. This script creates both.
 *
 * Usage:
 *   pnpm add-user
 *   pnpm add-user --email user@gmail.com --password "app-password" --provider gmail
 *   pnpm add-user --email user@example.com --password "pass" --imap-host imap.example.com --smtp-host smtp.example.com
 *
 * Note: The created user has no passkey. To log in, register a passkey at /register
 * and then link it to this user ID, or use the database directly to add a session.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createCipheriv, randomBytes, scryptSync } from "crypto";
import * as readline from "readline";

const db = new PrismaClient();

// Provider presets
const PROVIDERS: Record<string, { imapHost: string; imapPort: number; smtpHost: string; smtpPort: number }> = {
  gmail: { imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 587 },
  outlook: { imapHost: "outlook.office365.com", imapPort: 993, smtpHost: "smtp.office365.com", smtpPort: 587 },
  icloud: { imapHost: "imap.mail.me.com", imapPort: 993, smtpHost: "smtp.mail.me.com", smtpPort: 587 },
  yahoo: { imapHost: "imap.mail.yahoo.com", imapPort: 993, smtpHost: "smtp.mail.yahoo.com", smtpPort: 587 },
};

function encrypt(text: string): string {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }

  const key = scryptSync(secret, "kurir-salt", 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        args[key] = value;
        i++;
      }
    }
  }

  return args;
}

async function prompt(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (hidden) {
      process.stdout.write(question);
      let input = "";
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      const onData = (char: string) => {
        if (char === "\n" || char === "\r") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          console.log();
          rl.close();
          resolve(input);
        } else if (char === "\u0003") {
          process.exit();
        } else if (char === "\u007F") {
          input = input.slice(0, -1);
        } else {
          input += char;
        }
      };

      process.stdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function main() {
  const args = parseArgs();

  console.log("\nKurir - Add User + Email Connection\n");

  // Get email
  let email = args.email;
  if (!email) {
    email = await prompt("Email address: ");
  }

  if (!email || !email.includes("@")) {
    console.error("Invalid email address");
    process.exit(1);
  }

  // Check if an EmailConnection for this email already exists
  const existing = await db.emailConnection.findFirst({ where: { email } });
  if (existing) {
    const update = await prompt(`EmailConnection for ${email} already exists. Update credentials? (y/n): `);
    if (update.toLowerCase() !== "y") {
      console.log("Cancelled.");
      process.exit(0);
    }
  }

  // Get password
  let password = args.password;
  if (!password) {
    password = await prompt("Email password (app password): ", true);
  }

  if (!password) {
    console.error("Password is required");
    process.exit(1);
  }

  // Get provider or custom settings
  let imapHost = args["imap-host"];
  let imapPort = parseInt(args["imap-port"] || "993");
  let smtpHost = args["smtp-host"];
  let smtpPort = parseInt(args["smtp-port"] || "587");

  if (!imapHost || !smtpHost) {
    const provider = args.provider || await prompt("Provider (gmail/outlook/icloud/yahoo/custom): ");

    if (provider && PROVIDERS[provider]) {
      const preset = PROVIDERS[provider];
      imapHost = imapHost || preset.imapHost;
      imapPort = imapPort || preset.imapPort;
      smtpHost = smtpHost || preset.smtpHost;
      smtpPort = smtpPort || preset.smtpPort;
    } else {
      // Custom provider
      imapHost = imapHost || await prompt("IMAP host: ");
      smtpHost = smtpHost || await prompt("SMTP host: ");

      const customImapPort = await prompt(`IMAP port (${imapPort}): `);
      if (customImapPort) imapPort = parseInt(customImapPort);

      const customSmtpPort = await prompt(`SMTP port (${smtpPort}): `);
      if (customSmtpPort) smtpPort = parseInt(customSmtpPort);
    }
  }

  if (!imapHost || !smtpHost) {
    console.error("IMAP and SMTP hosts are required");
    process.exit(1);
  }

  // Optional: Verify IMAP credentials
  const verify = args["skip-verify"] !== "true" &&
    (await prompt("Verify IMAP credentials? (y/n): ")).toLowerCase() === "y";

  if (verify) {
    console.log("Verifying credentials...");
    try {
      const { ImapFlow } = await import("imapflow");
      const client = new ImapFlow({
        host: imapHost,
        port: imapPort,
        secure: true,
        auth: { user: email, pass: password },
        logger: false,
      });

      await client.connect();
      await client.logout();
      console.log("Credentials verified!");
    } catch (error) {
      console.error("IMAP connection failed:", error);
      const cont = await prompt("Continue anyway? (y/n): ");
      if (cont.toLowerCase() !== "y") {
        process.exit(1);
      }
    }
  }

  const encryptedPassword = encrypt(password);

  if (existing) {
    // Update the existing EmailConnection
    const updated = await db.emailConnection.update({
      where: { id: existing.id },
      data: { encryptedPassword, imapHost, imapPort, smtpHost, smtpPort },
    });
    console.log(`\nEmailConnection updated!`);
    console.log(`  Connection ID: ${updated.id}`);
    console.log(`  User ID:       ${updated.userId}`);
    console.log(`  Email:         ${email}`);
    console.log(`  IMAP:          ${imapHost}:${imapPort}`);
    console.log(`  SMTP:          ${smtpHost}:${smtpPort}`);
  } else {
    // Create a new User + EmailConnection
    const user = await db.user.create({
      data: {
        emailConnections: {
          create: {
            email,
            imapHost,
            imapPort,
            smtpHost,
            smtpPort,
            encryptedPassword,
            isDefault: true,
          },
        },
      },
      include: { emailConnections: true },
    });

    const connection = user.emailConnections[0];
    console.log(`\nUser and EmailConnection created!`);
    console.log(`  User ID:       ${user.id}`);
    console.log(`  Connection ID: ${connection.id}`);
    console.log(`  Email:         ${email}`);
    console.log(`  IMAP:          ${imapHost}:${imapPort}`);
    console.log(`  SMTP:          ${smtpHost}:${smtpPort}`);
    console.log(`\nNext: Register a passkey at http://localhost:3000/register`);
    console.log(`(The passkey will be linked to user ${user.id})\n`);
  }

  await db.$disconnect();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
