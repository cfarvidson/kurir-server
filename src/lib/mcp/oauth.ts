import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { Redis } from "ioredis";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/mcp/tokens";

export const MCP_PROTOCOL_VERSION = "2026-07-28";
export const MCP_SCOPE = "kurir";

const AUTH_CODE_TTL_MS = 2 * 60 * 1000;
const CIMD_CACHE_TTL_SECONDS = 300;
const CIMD_FETCH_TIMEOUT_MS = 5000;

let redis: Redis | null = null;

function getRedis(): Redis | null {
  // Unit tests must not depend on a leftover CIMD cache in a local Redis.
  if (process.env.NODE_ENV === "test") return null;
  if (!redis) {
    try {
      redis = new Redis(getConfig().redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        retryStrategy: () => null,
        protocol: 2, // ioredis 6 defaults to RESP3
      });
      redis.connect().catch(() => {});
    } catch {
      return null;
    }
  }
  return redis;
}

export function mcpIssuer(): string {
  return getConfig().baseUrl.replace(/\/+$/, "");
}

export function mcpResourceUri(): string {
  return `${mcpIssuer()}/mcp`;
}

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function codeChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  const expected = codeChallengeS256(verifier);
  const a = Buffer.from(expected);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface CimdDocument {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/**
 * Exact match against the CIMD redirect_uris, except that loopback redirects
 * (http://localhost or http://127.0.0.1) may use any port - native clients
 * such as Claude Code bind an ephemeral port per RFC 8252 §7.3.
 */
export function redirectUriAllowed(
  doc: CimdDocument,
  redirectUri: string,
): boolean {
  if (doc.redirect_uris.includes(redirectUri)) return true;
  let requested: URL;
  try {
    requested = new URL(redirectUri);
  } catch {
    return false;
  }
  if (requested.protocol !== "http:" || !isLoopbackHost(requested.hostname)) {
    return false;
  }
  return doc.redirect_uris.some((allowed) => {
    let u: URL;
    try {
      u = new URL(allowed);
    } catch {
      return false;
    }
    return (
      u.protocol === "http:" &&
      u.hostname === requested.hostname &&
      u.pathname === requested.pathname &&
      u.search === requested.search
    );
  });
}

function parseCimdUrl(clientIdUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(clientIdUrl);
  } catch {
    return null;
  }
  const isLoopback =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && isLoopback) return url;
  return null;
}

function parseCimdDocument(
  clientIdUrl: string,
  data: unknown,
): CimdDocument | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const rec = data as Record<string, unknown>;
  if (
    !Array.isArray(rec.redirect_uris) ||
    rec.redirect_uris.length === 0 ||
    !rec.redirect_uris.every((u) => typeof u === "string" && u.length > 0)
  ) {
    return null;
  }
  if (typeof rec.client_id === "string" && rec.client_id !== clientIdUrl) {
    return null;
  }
  const doc: CimdDocument = {
    client_id: typeof rec.client_id === "string" ? rec.client_id : clientIdUrl,
    redirect_uris: rec.redirect_uris,
  };
  if (typeof rec.client_name === "string") {
    doc.client_name = rec.client_name;
  }
  return doc;
}

async function readCimdCache(key: string): Promise<string | null> {
  const client = getRedis();
  if (!client) return null;
  try {
    return await client.get(key);
  } catch {
    return null;
  }
}

async function writeCimdCache(key: string, value: string): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    await client.setex(key, CIMD_CACHE_TTL_SECONDS, value);
  } catch {
    // Redis down: fetch every time.
  }
}

export async function fetchCimd(
  clientIdUrl: string,
): Promise<CimdDocument | null> {
  if (!parseCimdUrl(clientIdUrl)) return null;

  const cacheKey = `mcp:cimd:${clientIdUrl}`;
  const cached = await readCimdCache(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as CimdDocument;
    } catch {
      // Fall through to fetch.
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CIMD_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(clientIdUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const doc = parseCimdDocument(clientIdUrl, await res.json());
    if (!doc) return null;
    await writeCimdCache(cacheKey, JSON.stringify(doc));
    return doc;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function createAuthorizationCode(input: {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
}): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await db.mcpAuthorizationCode.create({
    data: {
      codeHash: hashToken(code),
      userId: input.userId,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      resource: input.resource,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  });
  return code;
}

export async function consumeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  resource: string;
}): Promise<{ userId: string; codeChallenge: string } | null> {
  const row = await db.mcpAuthorizationCode.findUnique({
    where: { codeHash: hashToken(input.code) },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  if (
    row.clientId !== input.clientId ||
    row.redirectUri !== input.redirectUri ||
    row.resource !== input.resource
  ) {
    return null;
  }
  try {
    await db.mcpAuthorizationCode.delete({ where: { id: row.id } });
  } catch {
    return null;
  }
  return { userId: row.userId, codeChallenge: row.codeChallenge };
}

export function protectedResourceMetadata(): Record<string, unknown> {
  const issuer = mcpIssuer();
  return {
    resource: mcpResourceUri(),
    authorization_servers: [issuer],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerMetadata(): Record<string, unknown> {
  const issuer = mcpIssuer();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    code_challenge_methods_supported: ["S256"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    authorization_response_iss_parameter_supported: true,
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
  };
}
