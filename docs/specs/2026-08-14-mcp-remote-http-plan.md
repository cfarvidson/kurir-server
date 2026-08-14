# Kurir MCP Remote HTTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a spec-2026-07-28 MCP server at `POST /mcp` so Claude can do mail plus the user's own settings against a self-hosted Kurir instance.

**Architecture:** Next.js owns the HTTP binding. Kurir is both OAuth resource server and authorization server. Tools call the same `src/lib/mail/*` functions as `/api/mobile`. Dangerous writes go through MRTR (`input_required`) backed by a `McpConfirmation` row.

**Tech Stack:** Next.js 16 App Router, Prisma 7, PostgreSQL, Redis (rate limit + CIMD cache), Zod, Vitest, existing passkey session for consent.

**Spec:** `docs/specs/2026-08-14-mcp-remote-http-design.md`

## Global Constraints

- Protocol version is only `2026-07-28`. No `initialize`, no `Mcp-Session-Id`, no SDK wrapper.
- UI copy is English. Follow `DESIGN.md` (terracotta, Inter, Playfair mastheads, no avatars).
- Every DB query filters by `userId`. Missing rows: `"not found or not yours"`.
- Tokens are opaque 32-byte base64url, stored SHA-256 hex. Never log bodies, codes, or raw tokens at info.
- Schema changes ship as idempotent `prisma/migrations/0013_mcp.sql`. Do not use `prisma db push` on non-empty DBs.
- Branch prefix `cfarvidson/`. Current branch: `cfarvidson/mcp-remote-http`.
- After each task: `npx prettier --write` on touched files, then commit.
- Tests: `pnpm test` (Vitest). Lint: `pnpm lint`.

## File map

Create:

- `prisma/migrations/0013_mcp.sql`
- `src/lib/mcp/tokens.ts` - issue/verify/rotate/revoke `McpToken`
- `src/lib/mcp/oauth.ts` - PKCE, CIMD, codes, metadata builders, resource URI
- `src/lib/mcp/cors.ts` - CORS headers + OPTIONS
- `src/lib/mcp/protocol.ts` - JSON-RPC dispatch
- `src/lib/mcp/auth.ts` - bearer + 401 challenge for `/mcp`
- `src/lib/mcp/confirmations.ts` - MRTR handle CRUD
- `src/lib/mcp/canonical-json.ts` - stable JSON + args hash
- `src/lib/mcp/serialize.ts` - compact rows / thread / settings
- `src/lib/mcp/types.ts` - shared MCP JSON-RPC + tool types
- `src/lib/mcp/tools/index.ts` - registry
- `src/lib/mcp/tools/mail.ts`
- `src/lib/mcp/tools/send.ts`
- `src/lib/mcp/tools/screener.ts`
- `src/lib/mcp/tools/contacts.ts`
- `src/lib/mcp/tools/settings.ts`
- `src/app/mcp/route.ts`
- `src/app/.well-known/oauth-protected-resource/route.ts`
- `src/app/.well-known/oauth-authorization-server/route.ts`
- `src/app/(auth)/oauth/authorize/page.tsx`
- `src/app/(auth)/oauth/authorize/consent-form.tsx`
- `src/app/api/oauth/token/route.ts`
- `src/components/settings/mcp-connections.tsx`
- `src/actions/mcp-tokens.ts` - list + revoke for settings UI
- `src/__tests__/unit/mcp-tokens.test.ts`
- `src/__tests__/unit/mcp-oauth.test.ts`
- `src/__tests__/unit/mcp-protocol.test.ts`
- `src/__tests__/unit/mcp-confirmations.test.ts`
- `src/__tests__/unit/mcp-serialize.test.ts`
- `src/__tests__/unit/mcp-tools-mail.test.ts`
- `src/__tests__/unit/mcp-tools-send.test.ts`
- `src/__tests__/integration/mcp-http.test.ts`
- `src/__tests__/integration/mcp-oauth-http.test.ts`

Modify:

- `prisma/schema.prisma` - User relations + three models
- `src/lib/rate-limit.ts` - `rateLimitOAuth(ip)`
- `src/proxy.ts` - public `/mcp`, well-known, `/api/oauth/token`
- `src/app/(mail)/settings/page.tsx` - Connected apps section
- `README.md` - Claude / MCP section

Do not import `"use server"` files from tools. Call `src/lib/mail/*` with `userId`.

---

### Task 1: Schema and token module

**Files:**

- Create: `prisma/migrations/0013_mcp.sql`
- Modify: `prisma/schema.prisma` (User relations after `domainRules`, new models after `MobileToken`)
- Create: `src/lib/mcp/tokens.ts`
- Test: `src/__tests__/unit/mcp-tokens.test.ts`

**Interfaces:**

- Consumes: `db` from `@/lib/db`, hash pattern from `src/lib/mobile/tokens.ts`
- Produces:

```ts
export interface IssuedMcpTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
}

export function hashToken(token: string): string;

export async function issueMcpTokens(input: {
  userId: string;
  clientId: string;
  clientName: string | null;
  resource: string;
}): Promise<IssuedMcpTokens>;

export async function verifyMcpAccessToken(
  accessToken: string,
  expectedResource: string,
): Promise<{ userId: string; tokenId: string } | null>;

export async function rotateMcpTokens(
  refreshToken: string,
  expectedResource: string,
): Promise<IssuedMcpTokens | null>;

export async function revokeMcpTokenById(
  userId: string,
  tokenId: string,
): Promise<boolean>;

export async function revokeMcpTokenByAccessToken(
  accessToken: string,
): Promise<void>;
```

`ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000`. Audience mismatch or expiry returns null.

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/unit/mcp-tokens.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    mcpToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe("mcp tokens", () => {
  beforeEach(() => vi.clearAllMocks());

  it("issueMcpTokens stores hashes, not plaintext", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mcpToken.create).mockResolvedValue({} as never);
    const { issueMcpTokens } = await import("@/lib/mcp/tokens");
    const tokens = await issueMcpTokens({
      userId: "user-1",
      clientId: "https://claude.ai/oauth/claude.json",
      clientName: "Claude",
      resource: "https://mail.example/mcp",
    });
    const data = vi.mocked(db.mcpToken.create).mock.calls[0][0].data as {
      accessTokenHash: string;
      refreshTokenHash: string;
      resource: string;
    };
    expect(data.accessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.accessTokenHash).not.toBe(tokens.accessToken);
    expect(data.resource).toBe("https://mail.example/mcp");
  });

  it("verifyMcpAccessToken rejects expired, wrong audience, and unknown", async () => {
    const { db } = await import("@/lib/db");
    const { verifyMcpAccessToken } = await import("@/lib/mcp/tokens");
    vi.mocked(db.mcpToken.findUnique).mockResolvedValue(null);
    expect(
      await verifyMcpAccessToken("x", "https://mail.example/mcp"),
    ).toBeNull();

    vi.mocked(db.mcpToken.findUnique).mockResolvedValue({
      id: "t1",
      userId: "u1",
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      resource: "https://other/mcp",
    } as never);
    expect(
      await verifyMcpAccessToken("x", "https://mail.example/mcp"),
    ).toBeNull();

    vi.mocked(db.mcpToken.findUnique).mockResolvedValue({
      id: "t1",
      userId: "u1",
      accessTokenExpiresAt: new Date(Date.now() - 1000),
      resource: "https://mail.example/mcp",
    } as never);
    expect(
      await verifyMcpAccessToken("x", "https://mail.example/mcp"),
    ).toBeNull();
  });

  it("rotateMcpTokens returns null when a concurrent rotation won", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.mcpToken.findUnique).mockResolvedValue({
      id: "t1",
      resource: "https://mail.example/mcp",
    } as never);
    vi.mocked(db.mcpToken.updateMany).mockResolvedValue({ count: 0 });
    const { rotateMcpTokens } = await import("@/lib/mcp/tokens");
    expect(
      await rotateMcpTokens("refresh", "https://mail.example/mcp"),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/unit/mcp-tokens.test.ts`

Expected: FAIL, cannot find `@/lib/mcp/tokens` or `db.mcpToken`.

- [ ] **Step 3: Schema + implementation**

Add on `User`:

```
mcpTokens             McpToken[]
mcpAuthorizationCodes McpAuthorizationCode[]
mcpConfirmations      McpConfirmation[]
```

After `MobileToken`, add `McpAuthorizationCode`, `McpToken`, `McpConfirmation` exactly as the spec data model. `McpConfirmation.tokenId` cascades from `McpToken`.

`0013_mcp.sql`: `CREATE TABLE IF NOT EXISTS` for all three, unique indexes on hash columns, FKs with `ON DELETE CASCADE`, indexes on `userId`. No enums.

Implement `src/lib/mcp/tokens.ts` by copying the race-safe `updateMany` pattern from `src/lib/mobile/tokens.ts`. `verifyMcpAccessToken` must compare `row.resource === expectedResource`.

- [ ] **Step 4: Run tests**

Run: `pnpm test src/__tests__/unit/mcp-tokens.test.ts` and `pnpm db:generate`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write prisma/schema.prisma prisma/migrations/0013_mcp.sql src/lib/mcp/tokens.ts src/__tests__/unit/mcp-tokens.test.ts
git add prisma/schema.prisma prisma/migrations/0013_mcp.sql src/lib/mcp/tokens.ts src/__tests__/unit/mcp-tokens.test.ts
git commit -m "feat(mcp): add token tables and hashed access tokens"
```

---

### Task 2: OAuth primitives, metadata, well-known routes

**Files:**

- Create: `src/lib/mcp/canonical-json.ts`
- Create: `src/lib/mcp/oauth.ts`
- Create: `src/lib/mcp/cors.ts`
- Modify: `src/lib/rate-limit.ts` (add `rateLimitOAuth`)
- Create: `src/app/.well-known/oauth-protected-resource/route.ts`
- Create: `src/app/.well-known/oauth-authorization-server/route.ts`
- Test: `src/__tests__/unit/mcp-oauth.test.ts`

**Interfaces:**

```ts
export const MCP_PROTOCOL_VERSION = "2026-07-28";
export const MCP_SCOPE = "kurir";

export function mcpResourceUri(): string; // `${getConfig().baseUrl}/mcp`
export function mcpIssuer(): string; // getConfig().baseUrl, no trailing slash

export function generateCodeVerifier(): string;
export function codeChallengeS256(verifier: string): string;
export function verifyPkce(verifier: string, challenge: string): boolean;

export function canonicalJson(value: unknown): string;
export function hashArgs(value: unknown): string; // sha256 hex of canonicalJson

export interface CimdDocument {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
}

export async function fetchCimd(
  clientIdUrl: string,
): Promise<CimdDocument | null>;
// Require https URL (http allowed only for localhost). Redis cache 300s key
// `mcp:cimd:${url}`. Fail closed. redirect_uris must be an array of strings.

export async function createAuthorizationCode(input: {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
}): Promise<string>; // plaintext code, TTL 2 minutes

export async function consumeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  resource: string;
}): Promise<{ userId: string; codeChallenge: string } | null>;

export function protectedResourceMetadata(): Record<string, unknown>;
export function authorizationServerMetadata(): Record<string, unknown>;

export function corsHeaders(methods: string): HeadersInit;
export function corsPreflight(methods: string): Response;

export function rateLimitOAuth(ip: string): Promise<RateLimitResult>;
// checkRateLimit(`oauth:${ip}`, 30, 600)
```

- [ ] **Step 1: Failing tests**

```ts
// src/__tests__/unit/mcp-oauth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    mcpAuthorizationCode: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe("pkce and canonical json", () => {
  it("S256 round-trips and rejects a wrong verifier", async () => {
    const { generateCodeVerifier, codeChallengeS256, verifyPkce } =
      await import("@/lib/mcp/oauth");
    const verifier = generateCodeVerifier();
    const challenge = codeChallengeS256(verifier);
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce("other", challenge)).toBe(false);
  });

  it("canonicalJson sorts keys so hashes are stable", async () => {
    const { canonicalJson, hashArgs } =
      await import("@/lib/mcp/canonical-json");
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
    expect(hashArgs({ z: 1, a: 2 })).toBe(hashArgs({ a: 2, z: 1 }));
  });
});

describe("CIMD", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("rejects non-https client_id and missing redirect", async () => {
    const { fetchCimd } = await import("@/lib/mcp/oauth");
    expect(await fetchCimd("http://evil.example/client.json")).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ client_id: "https://ok.example/c.json" }),
      }),
    );
    expect(await fetchCimd("https://ok.example/c.json")).toBeNull();
  });

  it("accepts a valid document", async () => {
    const { fetchCimd } = await import("@/lib/mcp/oauth");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          client_id: "https://ok.example/c.json",
          client_name: "Claude",
          redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        }),
      }),
    );
    const doc = await fetchCimd("https://ok.example/c.json");
    expect(doc?.client_name).toBe("Claude");
  });
});

describe("authorization codes", () => {
  it("consumeAuthorizationCode is one-time and checks binding", async () => {
    const { db } = await import("@/lib/db");
    const oauth = await import("@/lib/mcp/oauth");
    vi.mocked(db.mcpAuthorizationCode.create).mockResolvedValue({} as never);
    const code = await oauth.createAuthorizationCode({
      userId: "u1",
      clientId: "https://ok.example/c.json",
      redirectUri: "https://claude.ai/cb",
      codeChallenge: "abc",
      resource: "https://mail.example/mcp",
    });
    vi.mocked(db.mcpAuthorizationCode.findUnique).mockResolvedValue({
      id: "c1",
      userId: "u1",
      clientId: "https://ok.example/c.json",
      redirectUri: "https://claude.ai/cb",
      codeChallenge: "abc",
      resource: "https://mail.example/mcp",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    vi.mocked(db.mcpAuthorizationCode.delete).mockResolvedValue({} as never);
    const ok = await oauth.consumeAuthorizationCode({
      code,
      clientId: "https://ok.example/c.json",
      redirectUri: "https://claude.ai/cb",
      resource: "https://mail.example/mcp",
    });
    expect(ok).toEqual({ userId: "u1", codeChallenge: "abc" });
    const bad = await oauth.consumeAuthorizationCode({
      code,
      clientId: "https://ok.example/c.json",
      redirectUri: "https://evil.example/cb",
      resource: "https://mail.example/mcp",
    });
    expect(bad).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see fail**

Run: `pnpm test src/__tests__/unit/mcp-oauth.test.ts`

Expected: FAIL, modules missing.

- [ ] **Step 3: Implement**

PKCE: `base64url(randomBytes(32))` verifier, challenge = `base64url(sha256(verifier))` (RFC 7636 raw digest, not hex).

`canonicalJson`: recurse, sort object keys, `JSON.stringify` primitives, arrays in order.

`fetchCimd`: parse URL, require `https:` unless hostname is `localhost` / `127.0.0.1`. GET with 5s abort. Validate `redirect_uris` is a non-empty string array. Cache via ioredis the same way `src/lib/rate-limit.ts` gets Redis; if Redis is down, fetch every time.

Well-known GET handlers return JSON + CORS (`GET, OPTIONS`) + `Cache-Control: public, max-age=300`. OPTIONS uses `corsPreflight`.

Metadata fields exactly as the spec Discovery section.

- [ ] **Step 4: Run tests**

Run: `pnpm test src/__tests__/unit/mcp-oauth.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/mcp src/lib/rate-limit.ts src/app/.well-known src/__tests__/unit/mcp-oauth.test.ts
git add src/lib/mcp src/lib/rate-limit.ts src/app/.well-known src/__tests__/unit/mcp-oauth.test.ts
git commit -m "feat(mcp): add OAuth primitives and well-known metadata"
```

---

### Task 3: Authorize page and token endpoint

**Files:**

- Create: `src/app/(auth)/oauth/authorize/page.tsx`
- Create: `src/app/(auth)/oauth/authorize/consent-form.tsx`
- Create: `src/app/api/oauth/token/route.ts`
- Modify: `src/proxy.ts` (public paths)
- Test: `src/__tests__/integration/mcp-oauth-http.test.ts`

**Interfaces:**

- Consumes: `fetchCimd`, `createAuthorizationCode`, `consumeAuthorizationCode`, `verifyPkce`, `issueMcpTokens`, `rotateMcpTokens`, `mcpResourceUri`, `mcpIssuer`, `rateLimitOAuth`
- Produces: `GET /oauth/authorize`, `POST /api/oauth/token`

Proxy: add (sessionless):

```ts
const isMcp =
  req.nextUrl.pathname === "/mcp" || req.nextUrl.pathname.startsWith("/mcp/");
const isOAuthMeta =
  req.nextUrl.pathname === "/.well-known/oauth-protected-resource" ||
  req.nextUrl.pathname === "/.well-known/oauth-authorization-server";
const isOAuthToken = req.nextUrl.pathname === "/api/oauth/token";
```

Include them in the existing allow `if` next to `isMobileApi`. `/oauth/authorize` stays behind login redirect.

Authorize page (server component):

1. `rateLimitOAuth` on `x-forwarded-for` / `x-real-ip` / `"local"`. Over limit: 429 text.
2. Parse query. Require `response_type=code`, `code_challenge_method=S256`, `code_challenge`, `client_id`, `redirect_uri`, `resource`.
3. `resource` must equal `mcpResourceUri()`.
4. `fetchCimd(client_id)`. If null, render an English error, do not redirect.
5. `redirect_uri` must be in `doc.redirect_uris` (exact string match). Otherwise error, do not redirect.
6. `auth()` required. Unauthenticated is handled by proxy (`next=`).
7. Render consent: `PageMasthead` / `AuthShell` style, `SectionHeading` eyebrow "Claude / MCP", title "Connect an app". Body: `"{client_name} wants mail and your account settings on this Kurir instance."` Buttons Approve / Deny.

Consent form is a server action in the same folder (or `src/actions/mcp-oauth.ts`):

- Deny: `redirect(`${redirectUri}?error=access_denied&iss=${issuer}&state=${state}`)`.
- Approve: `createAuthorizationCode`, redirect with `code`, `iss`, `state`.

Build the redirect with `URLSearchParams`. Never use a redirect_uri that failed the CIMD check (re-fetch or pass the already-validated URI from hidden fields plus re-validate).

Token route `POST`:

- CORS + OPTIONS.
- Parse `application/x-www-form-urlencoded` via `req.formData()`.
- `grant_type=authorization_code`: consume code, `verifyPkce`, `issueMcpTokens` with `clientName` from a CIMD fetch (null if fetch fails after a valid code). Return JSON `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token }`.
- `grant_type=refresh_token`: `rotateMcpTokens`. 400 `invalid_grant` on null.
- Errors: `{ error, error_description }` with 400/401 as OAuth.

- [ ] **Step 1: Failing tests for the token route**

```ts
// src/__tests__/integration/mcp-oauth-http.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mcp/oauth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/mcp/oauth")>("@/lib/mcp/oauth");
  return {
    ...actual,
    consumeAuthorizationCode: vi.fn(),
    verifyPkce: vi.fn(),
    mcpResourceUri: () => "https://mail.example/mcp",
    fetchCimd: vi.fn().mockResolvedValue({
      client_id: "https://ok.example/c.json",
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/cb"],
    }),
  };
});

vi.mock("@/lib/mcp/tokens", () => ({
  issueMcpTokens: vi.fn().mockResolvedValue({
    accessToken: "access",
    refreshToken: "refresh",
    accessTokenExpiresAt: new Date(Date.now() + 3600_000),
  }),
  rotateMcpTokens: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitOAuth: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 }),
  };
});

function form(data: Record<string, string>) {
  return new Request("http://localhost/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data).toString(),
  });
}

describe("POST /api/oauth/token", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a bad PKCE verifier", async () => {
    const oauth = await import("@/lib/mcp/oauth");
    vi.mocked(oauth.consumeAuthorizationCode).mockResolvedValue({
      userId: "u1",
      codeChallenge: "chal",
    });
    vi.mocked(oauth.verifyPkce).mockReturnValue(false);
    const { POST } = await import("@/app/api/oauth/token/route");
    const res = await POST(
      form({
        grant_type: "authorization_code",
        code: "x",
        redirect_uri: "https://claude.ai/cb",
        client_id: "https://ok.example/c.json",
        code_verifier: "nope",
        resource: "https://mail.example/mcp",
      }) as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
  });

  it("issues tokens for a valid code", async () => {
    const oauth = await import("@/lib/mcp/oauth");
    vi.mocked(oauth.consumeAuthorizationCode).mockResolvedValue({
      userId: "u1",
      codeChallenge: "chal",
    });
    vi.mocked(oauth.verifyPkce).mockReturnValue(true);
    const { POST } = await import("@/app/api/oauth/token/route");
    const res = await POST(
      form({
        grant_type: "authorization_code",
        code: "x",
        redirect_uri: "https://claude.ai/cb",
        client_id: "https://ok.example/c.json",
        code_verifier: "yes",
        resource: "https://mail.example/mcp",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBe("access");
    expect(body.token_type).toBe("Bearer");
    expect(body.refresh_token).toBe("refresh");
  });
});
```

- [ ] **Step 2: Run to see fail**

Run: `pnpm test src/__tests__/integration/mcp-oauth-http.test.ts`

Expected: FAIL, route missing.

- [ ] **Step 3: Implement page, action, token route, proxy**

Read `DESIGN.md` before the consent UI. No avatars. English only.

- [ ] **Step 4: Run tests**

Run: `pnpm test src/__tests__/integration/mcp-oauth-http.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/app/\(auth\)/oauth src/app/api/oauth src/proxy.ts src/__tests__/integration/mcp-oauth-http.test.ts src/actions/mcp-oauth.ts
git add src/app/\(auth\)/oauth src/app/api/oauth src/proxy.ts src/__tests__/integration/mcp-oauth-http.test.ts src/actions/mcp-oauth.ts
git commit -m "feat(mcp): add OAuth authorize consent and token endpoint"
```

---

### Task 4: Protocol dispatcher and `POST /mcp`

**Files:**

- Create: `src/lib/mcp/types.ts`
- Create: `src/lib/mcp/protocol.ts`
- Create: `src/lib/mcp/auth.ts`
- Create: `src/lib/mcp/tools/index.ts` (empty registry ok; `tools/list` returns `[]` until later tasks)
- Create: `src/app/mcp/route.ts`
- Test: `src/__tests__/unit/mcp-protocol.test.ts`

**Interfaces:**

```ts
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface McpRequestMeta {
  protocolVersion?: string;
  clientCapabilities?: { elicitation?: unknown };
}

export function readMeta(params: unknown): McpRequestMeta;

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
  handler: (
    ctx: ToolContext,
    args: Record<string, unknown>,
  ) => Promise<ToolResult>;
}

export interface ToolContext {
  userId: string;
  tokenId: string;
  hasElicitation: boolean;
  inputResponses?: Record<string, { action?: string; content?: unknown }>;
  requestState?: string;
}

export type ToolResult =
  | { type: "ok"; structuredContent: unknown; text?: string }
  | { type: "error"; message: string }
  | {
      type: "input_required";
      requestState: string;
      message: string;
    };

export function registerTool(def: ToolDef): void;
export function listTools(): ToolDef[];
export function getTool(name: string): ToolDef | undefined;

export async function dispatchMcp(input: {
  headers: Headers;
  body: unknown;
  userId: string;
  tokenId: string;
}): Promise<{ status: number; json: unknown }>;

export function unauthorizedResponse(): Response;
// 401 + WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource", scope="kurir"
```

Header rules (reject as JSON-RPC error `-32600`):

- `MCP-Protocol-Version` must be `2026-07-28` (also accept `Mcp-Protocol-Version`).
- `Mcp-Method` required and must equal `body.method`.
- If `method === "tools/call"`, `Mcp-Name` required and must equal `params.name`.

Methods:

- `server/discover` -> `{ protocolVersion, serverInfo: { name: "kurir", version: package.json version }, capabilities: { tools: {} } }`
- `tools/list` -> `{ tools: [...], ttlMs: 300000, cacheScope: "server" }`
- `tools/call` -> run handler. `ok` becomes `{ content: [{ type: "text", text }], structuredContent, isError: false }`. `error` sets `isError: true`. `input_required` becomes `{ resultType: "input_required", requestState, inputRequests: { confirm: { method: "elicitation/create", params: { mode: "form", message, requestedSchema: { type: "object", properties: {} } } } } }`.

`POST /mcp`: OPTIONS preflight. GET/DELETE 405. Read JSON. `rateLimitUser` after auth. No token: `unauthorizedResponse()`. Token ok: `dispatchMcp`.

- [ ] **Step 1: Failing tests**

```ts
// src/__tests__/unit/mcp-protocol.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mcp/tools", () => {
  const tools = new Map();
  return {
    registerTool: (d: { name: string }) => tools.set(d.name, d),
    listTools: () => [...tools.values()],
    getTool: (n: string) => tools.get(n),
  };
});

function headers(h: Record<string, string>) {
  return new Headers(h);
}

describe("dispatchMcp", () => {
  beforeEach(() => vi.resetModules());

  it("rejects the wrong protocol version", async () => {
    const { dispatchMcp } = await import("@/lib/mcp/protocol");
    const res = await dispatchMcp({
      headers: headers({
        "MCP-Protocol-Version": "2025-11-25",
        "Mcp-Method": "server/discover",
      }),
      body: { jsonrpc: "2.0", id: 1, method: "server/discover" },
      userId: "u1",
      tokenId: "t1",
    });
    expect(res.json).toMatchObject({
      error: { message: expect.stringContaining("2026-07-28") },
    });
  });

  it("rejects header/body method mismatch", async () => {
    const { dispatchMcp } = await import("@/lib/mcp/protocol");
    const res = await dispatchMcp({
      headers: headers({
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/list",
      }),
      body: { jsonrpc: "2.0", id: 1, method: "server/discover" },
      userId: "u1",
      tokenId: "t1",
    });
    expect((res.json as { error?: unknown }).error).toBeTruthy();
  });

  it("server/discover lists tools capability only", async () => {
    const { dispatchMcp } = await import("@/lib/mcp/protocol");
    const res = await dispatchMcp({
      headers: headers({
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "server/discover",
      }),
      body: { jsonrpc: "2.0", id: 1, method: "server/discover" },
      userId: "u1",
      tokenId: "t1",
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      result: { capabilities: { tools: {} } },
    });
    expect(
      (res.json as { result: { capabilities: Record<string, unknown> } }).result
        .capabilities.resources,
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to see fail**

Run: `pnpm test src/__tests__/unit/mcp-protocol.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement dispatcher + route**

Read `_meta` from `params._meta` using keys `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities`. `hasElicitation` is true when `clientCapabilities.elicitation` is present.

- [ ] **Step 4: Run tests**

Run: `pnpm test src/__tests__/unit/mcp-protocol.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/mcp src/app/mcp src/__tests__/unit/mcp-protocol.test.ts
git add src/lib/mcp src/app/mcp src/__tests__/unit/mcp-protocol.test.ts
git commit -m "feat(mcp): add stateless JSON-RPC dispatcher and POST /mcp"
```

---

### Task 5: MRTR confirmations

**Files:**

- Create: `src/lib/mcp/confirmations.ts`
- Test: `src/__tests__/unit/mcp-confirmations.test.ts`

**Interfaces:**

```ts
export async function createConfirmation(input: {
  userId: string;
  tokenId: string;
  toolName: string;
  args: unknown;
}): Promise<{ id: string; message: string }>;
// persist argsJson + argsHash, expiresAt = now + 10 minutes

export async function consumeConfirmation(input: {
  id: string;
  userId: string;
  tokenId: string;
  toolName: string;
  args: unknown;
  action: string | undefined;
}): Promise<"accept" | "cancel" | "mismatch">;
```

On accept: `updateMany` where `id, consumedAt: null` set `consumedAt: now`; if count is 0 return `"mismatch"`. Then the caller mutates. To keep "same transaction as mutation", export a second helper used by send later:

```ts
export async function consumeConfirmationInTx(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    userId: string;
    tokenId: string;
    toolName: string;
    args: unknown;
  },
): Promise<boolean>;
```

Task 5 tests the non-tx helper. Send (Task 9) uses the tx helper.

If `action !== "accept"`: set `consumedAt`, return `"cancel"`.

- [ ] **Step 1: Failing tests**

```ts
it("accept is single-use and hash-bound", async () => {
  const { db } = await import("@/lib/db");
  const { hashArgs } = await import("@/lib/mcp/canonical-json");
  const args = { to: ["a@b.c"], subject: "Hi" };
  vi.mocked(db.mcpConfirmation.findUnique).mockResolvedValue({
    id: "h1",
    userId: "u1",
    tokenId: "t1",
    toolName: "send_mail",
    argsHash: hashArgs(args),
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  } as never);
  vi.mocked(db.mcpConfirmation.updateMany).mockResolvedValue({ count: 1 });
  const { consumeConfirmation } = await import("@/lib/mcp/confirmations");
  expect(
    await consumeConfirmation({
      id: "h1",
      userId: "u1",
      tokenId: "t1",
      toolName: "send_mail",
      args,
      action: "accept",
    }),
  ).toBe("accept");
  expect(
    await consumeConfirmation({
      id: "h1",
      userId: "u1",
      tokenId: "t1",
      toolName: "send_mail",
      args: { to: ["evil@b.c"], subject: "Hi" },
      action: "accept",
    }),
  ).toBe("mismatch");
});
```

Also test expired (`expiresAt` past -> mismatch), deny -> cancel, missing row -> mismatch.

- [ ] **Step 2: Run to see fail**

Run: `pnpm test src/__tests__/unit/mcp-confirmations.test.ts`

- [ ] **Step 3: Implement `confirmations.ts`**

- [ ] **Step 4: Run tests** - expected PASS.

- [ ] **Step 5: Commit** `feat(mcp): add MRTR confirmation handles`

---

### Task 6: Read tools (`list_mail`, `get_thread`, `search_mail`, `get_counts`, `get_attachment`)

**Files:**

- Create: `src/lib/mcp/serialize.ts`
- Create: `src/lib/mcp/tools/mail.ts`
- Modify: `src/lib/mcp/tools/index.ts` (import to register)
- Test: `src/__tests__/unit/mcp-serialize.test.ts`
- Test: `src/__tests__/unit/mcp-tools-mail.test.ts`

**View mapping:**

| MCP view                           | Implementation                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `imbox` `feed` `archive` `snoozed` | `getMessages(userId, view, limit, cursor)`                                          |
| `paper_trail`                      | `getMessages(userId, "paper-trail", ...)`                                           |
| `follow_up`                        | `getMessages(userId, "follow-up", ...)`                                             |
| `reply_later`                      | `getMessages(userId, "reply-later", ...)`                                           |
| `screener`                         | pending senders via `visiblePendingSenderWhere` + latest message, not `getMessages` |
| `sent`                             | messages in folders with `specialUse: "sent"` for the user's connections            |
| `drafts`                           | `listDraftsForUser`                                                                 |
| `scheduled`                        | `db.scheduledMessage.findMany({ where: { userId } })`                               |
| `files`                            | `getFiles` from `@/lib/mail/files`                                                  |

Default limit 25, max 50. `unreadOnly` adds `isRead: false` on message views.

`get_thread` uses `getThreadMessages(userId, messageId)`. Text: existing body field if present, else strip HTML. Attachments: id/filename/contentType/size.

`search_mail` uses `searchMessages` then re-fetch like `/api/mobile/search`.

`get_counts` uses `getSidebarCounts(userId)`.

`get_attachment`: load via `db.attachment` scoped to user (same ownership as download route). Inline text/* and images jpeg/png/gif/webp if `size <= 1_000_000`. Else `{ openInApp: true, filename, contentType, size }`.

`connectionId`: if provided, verify ownership and add to where. If omitted, do not filter (PWA lists are user-global) except send/sync which use default connection.

- [ ] **Step 1: Failing serializer + list_mail tests**

Assert compact row has `id`, `from`, `subject`, `snippet`, `isRead` and no `htmlBody`.

Assert `list_mail` with view `imbox` calls `getMessages("u1", "imbox", 25, undefined)`.

Assert unknown view returns `{ type: "error", message: ... }`.

- [ ] **Step 2: Run to see fail**

- [ ] **Step 3: Implement serialize + mail tools + register them**

Each tool's `handler` catches thrown `Error` and returns `{ type: "error", message }`.

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit** `feat(mcp): add read tools for lists, thread, search, counts`

---

### Task 7: Immediate write tools (thread, drafts, scheduled, screener, contacts, settings)

**Files:**

- Modify: `src/lib/mcp/tools/mail.ts` (`update_thread`, drafts, scheduled)
- Create: `src/lib/mcp/tools/screener.ts`
- Create: `src/lib/mcp/tools/contacts.ts`
- Create: `src/lib/mcp/tools/settings.ts`
- Test: extend `mcp-tools-mail.test.ts` plus `src/__tests__/unit/mcp-tools-settings.test.ts`

**Call existing functions (do not reimplement):**

- `archiveThread`, `unarchiveThread`, `setThreadReadState`, `snoozeThread`, `unsnoozeThread`, `setThreadFollowUp`, `dismissThreadFollowUp`, `setThreadReplyLater` from `@/lib/mail/mutations` (clear reply-later: find the matching function used by mobile `clearReplyLater` - `setThreadReplyLater` with a clear path; read `mutations.ts` and mobile actions).
- Drafts: `saveDraftForUser`, `deleteDraftForUser`.
- Scheduled: functions in `@/lib/mail` / `src/actions/scheduled-messages.ts` - extract userId-first helpers if the action file is the only entry (copy the pattern in `src/lib/mail/drafts.ts`). Prefer extracting over importing `"use server"`.
- Screener: `approveSenderForUser`, `skipSenderForUser`, `unskipSenderForUser`, `undoScreenActionForUser`, `changeSenderCategoryForUser`, `setSenderUnthreadForUser`, `setSenderAllowImagesForUser`, domain-rule helpers. `reject` is registered here but must call the MRTR wrapper from Task 8; until Task 8, `action: "reject"` returns error `"this client cannot confirm this action"` if `!ctx.hasElicitation`, else `input_required` via `createConfirmation`.
- Contacts: lift userId-first cores out of `src/actions/contacts.ts` / `contact-groups.ts` into `src/lib/mail/contacts.ts` (or existing module) if they are not already there. Check before extracting.
- Settings: `db.user.update` for displayName/theme/timezone/image/badges. Connections: same updates as `PATCH /api/connections/[id]` without password/host. Honor `canManageConnections`. Passkeys: `db.passkey.findMany` select safe fields.

After count-changing mutations call `revalidateTag("sidebar-counts")` / `updateTag("sidebar-counts")` the same way actions do.

- [ ] **Step 1: Failing tests** for `update_thread` archive calling `archiveThread`, and `update_settings` rejecting empty `displayName`.

- [ ] **Step 2: Run to see fail**

- [ ] **Step 3: Implement all immediate tools listed in the spec tables (except send/schedule/send_now).**

Include `upload_attachment` here (not MRTR): decode base64, max 5 MB, `rateLimitUploads`, reuse the store used by `/api/attachments/upload`.

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit** `feat(mcp): add write tools for thread, screener, contacts, settings`

---

### Task 8: Dangerous tools with MRTR (send, schedule, deletes)

**Files:**

- Create: `src/lib/mcp/tools/send.ts`
- Modify: screener/contacts/settings tools for reject/delete paths
- Test: `src/__tests__/unit/mcp-tools-send.test.ts`

**Send path:** Extract `sendMailForUser(userId, input)` from `src/app/api/mail/send/route.ts` into `src/lib/mail/send.ts` so the HTTP route and the MCP tool share one function. Keep the route as a thin wrapper. Do not change send semantics.

`send_mail` / `schedule_mail` / `send_scheduled_now`:

1. If `isDemoInstance()`, return error, no confirmation.
2. If `!ctx.hasElicitation`, return error `"this client cannot confirm this action"`.
3. If no `requestState`, `createConfirmation` and return `input_required` with a message that includes to/cc/bcc/subject/body preview (first 500 chars).
4. If `requestState`, `consumeConfirmation` / `consumeConfirmationInTx`. `accept` then send. `cancel` -> error `"cancelled"`. `mismatch` -> error `"confirmation does not match arguments"`.

`schedule_mail` uses the existing scheduled-message create helper.

Same wrapper for `screen_sender reject`, `create_domain_rule REJECTED`, `delete_contact`, `delete_contact_group`, `delete_connection` (block last connection), `revoke_passkey`, `bulk_approve_old_senders` (include count in the message).

- [ ] **Step 1: Failing tests**

```ts
it("send_mail without elicitation does not send", async () => {
  const send = vi.fn();
  // handler with hasElicitation: false
  expect(result.type).toBe("error");
  expect(send).not.toHaveBeenCalled();
});

it("send_mail first call returns input_required", async () => { ... });

it("send_mail accept with matching args sends once", async () => { ... });

it("send_mail accept with swapped to does not send", async () => { ... });
```

Mock SMTP / `sendMailForUser`.

- [ ] **Step 2: Run to see fail**

- [ ] **Step 3: Extract send helper + implement MRTR tools**

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit** `feat(mcp): require MRTR confirmation before send and deletes`

---

### Task 9: Settings UI, README, HTTP integration tests

**Files:**

- Create: `src/components/settings/mcp-connections.tsx`
- Create: `src/actions/mcp-tokens.ts` (`listMcpConnections`, `revokeMcpConnection`)
- Modify: `src/app/(mail)/settings/page.tsx` (Account tab, after Passkeys)
- Modify: `README.md` (Features bullet + a "Claude / MCP" section)
- Test: `src/__tests__/integration/mcp-http.test.ts`

**Settings UI:** `SectionHeading` eyebrow `"Apps"`, title `"Connected apps"`. List clientName, createdAt, lastUsedAt. Revoke button (English "Revoke"). Empty: "No connected apps".

**README** (English):

```
## Claude / MCP

Point Claude at `https://<your-domain>/mcp` as a custom connector. Sign in
with your Kurir passkey and approve access. The agent can read and search
mail, triage, screen senders, and change your own settings. Sending and
other destructive actions ask for a confirmation in Claude first. Revoke
access under Settings → Connected apps.
```

Add a Features bullet: `**MCP** - Connect Claude to your instance at \`/mcp\`.`

**Integration tests** (`mcp-http.test.ts`): mock `verifyMcpAccessToken`, `rateLimitUser`, and tool deps.

1. `POST /mcp` no auth -> 401, `WWW-Authenticate` contains `resource_metadata` and `oauth-protected-resource`.
2. Authenticated `server/discover` and `tools/list` -> 200, catalog includes `list_mail` and `send_mail`, does not include wipe/admin tools.
3. `list_mail` imbox -> 200 structured items.
4. `GET /.well-known/oauth-protected-resource` -> `resource` ends with `/mcp`, `authorization_servers` present.
5. `GET /mcp` -> 405.

- [ ] **Step 1: Write integration tests (fail)**

- [ ] **Step 2: Run to see fail**

- [ ] **Step 3: Wire UI + README + fix any route gaps**

- [ ] **Step 4: Run `pnpm test src/__tests__/integration/mcp-http.test.ts src/__tests__/unit/mcp-*.test.ts src/__tests__/integration/mcp-oauth-http.test.ts` and `pnpm lint`**

Expected: all green.

- [ ] **Step 5: Commit** `feat(mcp): add connected-apps settings and connector docs`

---

## Spec coverage (self-review)

| Spec section                                              | Task                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| `POST /mcp`, headers, 2026-07-28 only, no SSE             | 4                                                                 |
| Unauthenticated 401 + WWW-Authenticate, no login redirect | 3 (proxy) + 4                                                     |
| CORS                                                      | 2 + 3 + 4                                                         |
| Well-known metadata                                       | 2                                                                 |
| Authorize + CIMD + PKCE + iss                             | 3                                                                 |
| Token + rotate + audience                                 | 1 + 3                                                             |
| McpConfirmation MRTR                                      | 5 + 8                                                             |
| Read tools                                                | 6                                                                 |
| Immediate writes                                          | 7                                                                 |
| Dangerous writes + demo + no elicitation                  | 8                                                                 |
| Connected apps UI + README                                | 9                                                                 |
| Rate limits                                               | 2 (`rateLimitOAuth`), 4 (`rateLimitUser`), 7/8 (send/sync/upload) |
| Migration 0013                                            | 1                                                                 |
| Admin/wipe absent                                         | 9 list assertion                                                  |
| Tests listed in spec                                      | 1, 2, 3, 4, 5, 8, 9                                               |

No MCP Apps, Tasks, resources, prompts, DCR, stdio, add-connection, or passkey register.

## Definition of done

`pnpm test` and `pnpm lint` pass. A user can add `https://<domain>/mcp` in Claude, passkey-consent, then list/read/search/archive/screen/send (after MRTR) and revoke under Settings.
