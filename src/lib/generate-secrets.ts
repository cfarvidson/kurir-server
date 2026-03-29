import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ENV_PATH = join(process.cwd(), ".env");

/**
 * Auto-generate missing secrets and persist them to `.env`.
 *
 * Only generates values that are not already set in the environment.
 * Appends to `.env` (creating it if needed) so values persist across restarts.
 */
export async function generateSecrets(): Promise<void> {
  const generated: Record<string, string> = {};

  // NEXTAUTH_SECRET / AUTH_SECRET
  if (!process.env.NEXTAUTH_SECRET && !process.env.AUTH_SECRET) {
    const secret = randomBytes(32).toString("base64");
    process.env.AUTH_SECRET = secret;
    process.env.NEXTAUTH_SECRET = secret;
    generated["AUTH_SECRET"] = secret;
    console.log("[generate-secrets] Generated AUTH_SECRET");
  }

  // ENCRYPTION_KEY
  if (!process.env.ENCRYPTION_KEY) {
    const key = randomBytes(32).toString("base64");
    process.env.ENCRYPTION_KEY = key;
    generated["ENCRYPTION_KEY"] = key;
    console.log("[generate-secrets] Generated ENCRYPTION_KEY");
  }

  // VAPID keys
  // Use bracket notation for NEXT_PUBLIC_* to prevent webpack from inlining
  // the env var reference as a string literal (which breaks minification).
  const VAPID_PUB_KEY = "NEXT_PUBLIC_VAPID_PUBLIC_KEY";
  if (!process.env[VAPID_PUB_KEY] || !process.env.VAPID_PRIVATE_KEY) {
    // Dynamic import to avoid loading web-push at module level
    const webpush = await import("web-push");
    const vapidKeys = webpush.generateVAPIDKeys();
    process.env[VAPID_PUB_KEY] = vapidKeys.publicKey;
    process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
    generated[VAPID_PUB_KEY] = vapidKeys.publicKey;
    generated["VAPID_PRIVATE_KEY"] = vapidKeys.privateKey;
    console.log("[generate-secrets] Generated VAPID keypair");
  }

  // Persist to .env file
  if (Object.keys(generated).length > 0) {
    persistToEnvFile(generated);
  }
}

function persistToEnvFile(vars: Record<string, string>): void {
  try {
    let content = "";
    if (existsSync(ENV_PATH)) {
      content = readFileSync(ENV_PATH, "utf-8");
    }

    const lines: string[] = [];
    if (content && !content.endsWith("\n")) {
      lines.push(""); // ensure newline before our block
    }
    lines.push("# Auto-generated secrets (generated on first boot)");

    for (const [key, value] of Object.entries(vars)) {
      // Skip if already in file (even if commented or different value)
      const pattern = new RegExp(`^${key}=`, "m");
      if (pattern.test(content)) continue;
      lines.push(`${key}="${value}"`);
    }

    if (lines.length > 1) {
      writeFileSync(ENV_PATH, content + lines.join("\n") + "\n", {
        mode: 0o600,
      });
      console.log(`[generate-secrets] Persisted secrets to ${ENV_PATH}`);
    }
  } catch (err) {
    // Read-only filesystem (e.g. Docker without mounted .env) — warn but don't crash
    console.warn(
      `[generate-secrets] Could not persist to .env: ${(err as Error).message}`,
    );
    console.warn(
      "[generate-secrets] Secrets are set for this process but won't survive restart.",
    );
  }
}
