/**
 * The Grok Build session blob: access + refresh, the auth.json shape written
 * by `grok login`. Pure parsing shared by credential intake and the Grok
 * inference adapter.
 */

export type GrokSession = { access: string; refresh: string };

/** Parse a stored/pasted Grok Build session blob. Returns null if unusable. */
export function parseGrokSession(raw: string): GrokSession | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const access =
    record.access ?? record.accessToken ?? record.access_token ?? null;
  const refresh =
    record.refresh ?? record.refreshToken ?? record.refresh_token ?? null;
  if (typeof refresh !== "string" || refresh.length === 0) return null;
  if (typeof access !== "string") return null;
  return { access, refresh };
}

/** Serialize a Grok session into the canonical stored plaintext shape. */
export function serializeGrokSession(session: GrokSession): string {
  return JSON.stringify(session);
}
