import { z } from "zod";

/**
 * Central configuration module.
 *
 * Reads env vars once, validates with Zod, and derives values from
 * KURIR_DOMAIN so self-hosted deployments only need to set one or two vars.
 */

const envSchema = z.object({
  // --- Domain (the only required var for production) ---
  KURIR_DOMAIN: z.string().default("localhost"),

  // --- Database ---
  DATABASE_URL: z
    .string()
    .default("postgresql://kurir:kurir@localhost:5432/kurir"),

  // --- Secrets (auto-generated if missing via generate-secrets.ts) ---
  NEXTAUTH_SECRET: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  ENCRYPTION_SALT: z.string().default("kurir-salt"),

  // --- VAPID (auto-generated if missing) ---
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),

  // --- Redis ---
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // --- OAuth providers (optional) ---
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // --- WebAuthn overrides (derived from domain by default) ---
  WEBAUTHN_RP_NAME: z.string().default("Kurir"),
  WEBAUTHN_RP_ID: z.string().optional(),

  // --- Admin ---
  KURIR_ADMIN_EMAIL: z.string().optional(),

  // --- Runtime ---
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  NEXTAUTH_URL: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

function buildConfig(env: Env) {
  const domain = env.KURIR_DOMAIN;
  const isLocalhost = domain === "localhost" || domain.startsWith("localhost:");
  const protocol = isLocalhost ? "http" : "https";
  const baseUrl = env.NEXTAUTH_URL ?? `${protocol}://${domain}`;

  // AUTH_SECRET is the NextAuth v5 name; NEXTAUTH_SECRET is v4 compat
  const nextauthSecret = env.AUTH_SECRET ?? env.NEXTAUTH_SECRET;

  return {
    domain,
    baseUrl,
    isProduction: env.NODE_ENV === "production",

    redisUrl: env.REDIS_URL,

    nextauthSecret,
    encryptionKey: env.ENCRYPTION_KEY,
    encryptionSalt: env.ENCRYPTION_SALT,

    webauthn: {
      rpName: env.WEBAUTHN_RP_NAME,
      rpId: env.WEBAUTHN_RP_ID ?? domain,
      origin: baseUrl,
    },

    vapid: {
      publicKey: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      configured: !!(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
    },

    oauth: {
      microsoft: {
        clientId: env.MICROSOFT_CLIENT_ID,
        clientSecret: env.MICROSOFT_CLIENT_SECRET,
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },

    adminEmail: env.KURIR_ADMIN_EMAIL,
  };
}

export type Config = ReturnType<typeof buildConfig>;

// Lazy singleton — validated once on first access
let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = buildConfig(envSchema.parse(process.env));
  }
  return _config;
}

/** Call after generate-secrets.ts to re-parse env with newly set values. */
export function resetConfig(): void {
  _config = null;
}

/**
 * Validate that all required secrets are present.
 * Call this after secret generation in instrumentation.ts.
 * Throws with a clear message listing every missing var.
 */
export function validateConfig(): void {
  const config = getConfig();
  const missing: string[] = [];

  if (!config.nextauthSecret) missing.push("NEXTAUTH_SECRET (or AUTH_SECRET)");
  if (!config.encryptionKey) missing.push("ENCRYPTION_KEY");

  if (missing.length > 0) {
    throw new Error(
      `[config] Missing required environment variables:\n` +
        missing.map((v) => `  - ${v}`).join("\n") +
        `\n\nThese should auto-generate on first boot. ` +
        `If running in a read-only filesystem, set them manually.`,
    );
  }

  console.log(`[config] Validated — domain=${config.domain}`);
}
