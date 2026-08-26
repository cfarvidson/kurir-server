import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { isDemoInstance } from "@/lib/demo";
import {
  DraftGenerationError,
  type DraftGenerationProvider,
  type DraftGenerationStatus,
} from "@/lib/draft-generation/types";

import {
  parseGrokSession,
  serializeGrokSession,
} from "@/lib/draft-generation/grok-session";

/**
 * Credential intake and storage for draft generation. One provider per user.
 * Only subscription credentials are accepted: a Claude Code setup-token
 * (`sk-ant-oat…`) or a Grok Build session (access + refresh, the auth.json
 * shape after `grok login`). Pay-per-token API keys are refused so the
 * feature can never silently start a metered bill.
 */

/**
 * Classify a pasted credential for `provider`, returning the normalized
 * plaintext secret to encrypt, or throwing TOKEN_REJECTED with a message the
 * settings UI shows verbatim.
 */
export function classifyDraftGenerationToken(
  provider: DraftGenerationProvider,
  raw: string,
): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new DraftGenerationError("TOKEN_REJECTED", "Paste a token first.");
  }
  if (trimmed.startsWith("sk-ant-api")) {
    throw new DraftGenerationError(
      "TOKEN_REJECTED",
      "That is an Anthropic Console API key, which bills per token. Paste the output of `claude setup-token` instead.",
    );
  }
  if (trimmed.startsWith("xai-")) {
    throw new DraftGenerationError(
      "TOKEN_REJECTED",
      "That is an xAI API key, which bills per token. Paste a Grok Build session instead.",
    );
  }
  if (provider === "claudeCode") {
    if (!trimmed.startsWith("sk-ant-oat")) {
      throw new DraftGenerationError(
        "TOKEN_REJECTED",
        "That does not look like a Claude Code setup-token. Run `claude setup-token` and paste its output.",
      );
    }
    return trimmed;
  }
  const session = parseGrokSession(trimmed);
  if (!session) {
    throw new DraftGenerationError(
      "TOKEN_REJECTED",
      "That does not look like a Grok Build session. Sign in with `grok login` and paste the contents of ~/.grok/auth.json.",
    );
  }
  return serializeGrokSession(session);
}

/** Connected + provider for the settings UI. Never decrypts. */
export async function getDraftGenerationStatus(
  userId: string,
): Promise<DraftGenerationStatus> {
  const row = await db.draftGenerationCredential.findUnique({
    where: { userId },
    select: { provider: true },
  });
  if (!row) return { connected: false, provider: null };
  return {
    connected: true,
    provider: row.provider as DraftGenerationProvider,
  };
}

/**
 * Classify, encrypt, and store the one credential for this user, replacing
 * any previous provider. Refused on the demo instance before anything is
 * classified or written.
 */
export async function saveDraftGenerationCredential(
  userId: string,
  provider: DraftGenerationProvider,
  rawToken: string,
): Promise<DraftGenerationStatus> {
  if (isDemoInstance()) {
    throw new DraftGenerationError(
      "DEMO_INSTANCE",
      "Draft generation is disabled on this demo instance.",
    );
  }
  const secret = classifyDraftGenerationToken(provider, rawToken);
  const encryptedSecret = encrypt(secret);
  await db.draftGenerationCredential.upsert({
    where: { userId },
    update: { provider, encryptedSecret },
    create: { userId, provider, encryptedSecret },
  });
  return { connected: true, provider };
}

/** Remove the credential. Idempotent, turns the feature off on every client. */
export async function removeDraftGenerationCredential(
  userId: string,
): Promise<DraftGenerationStatus> {
  await db.draftGenerationCredential.deleteMany({ where: { userId } });
  return { connected: false, provider: null };
}

/**
 * Decrypt the stored secret for generation (and Grok refresh). Internal to
 * the module — never expose the return value through an action or route.
 */
export async function loadDraftGenerationSecret(
  userId: string,
): Promise<{ provider: DraftGenerationProvider; secret: string } | null> {
  const row = await db.draftGenerationCredential.findUnique({
    where: { userId },
  });
  if (!row) return null;
  return {
    provider: row.provider as DraftGenerationProvider,
    secret: decrypt(row.encryptedSecret),
  };
}

/** Re-encrypt and store a rotated secret (Grok refresh writes through this). */
export async function rotateDraftGenerationSecret(
  userId: string,
  secret: string,
): Promise<void> {
  await db.draftGenerationCredential.update({
    where: { userId },
    data: { encryptedSecret: encrypt(secret) },
  });
}
