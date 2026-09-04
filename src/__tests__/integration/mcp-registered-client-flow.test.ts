import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * End-to-end authorization-code flow for an admin-registered (kmc_) client:
 * consent action -> code -> token endpoint, with the real oauth.ts (PKCE,
 * code binding, client resolution) and an in-memory stand-in for the db.
 */

const REDIRECT = "https://grok-bot.example/oauth/callback";
const CLIENT_ID = "kmc_registered0000000000000000";
const RESOURCE = "https://mail.example/mcp";

type CodeRow = {
  id: string;
  codeHash: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  expiresAt: Date;
};
const codes = new Map<string, CodeRow>();

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    baseUrl: "https://mail.example",
    redisUrl: "redis://unused",
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    mcpClient: {
      findUnique: vi.fn(async ({ where }: { where: { clientId: string } }) =>
        where.clientId === CLIENT_ID
          ? { clientId: CLIENT_ID, name: "Grok Bot", redirectUris: [REDIRECT] }
          : null,
      ),
    },
    mcpAuthorizationCode: {
      create: vi.fn(async ({ data }: { data: Omit<CodeRow, "id"> }) => {
        const row = { id: `c${codes.size + 1}`, ...data };
        codes.set(row.codeHash, row);
        return row;
      }),
      findUnique: vi.fn(
        async ({ where }: { where: { codeHash: string } }) =>
          codes.get(where.codeHash) ?? null,
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        for (const [hash, row] of codes) {
          if (row.id === where.id) codes.delete(hash);
        }
        return {};
      }),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "u1" } }),
}));

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super("redirect");
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

vi.mock("@/lib/mcp/tokens", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    issueMcpTokens: vi.fn().mockResolvedValue({
      accessToken: "access",
      refreshToken: "refresh",
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    }),
    rotateMcpTokens: vi.fn(),
  };
});

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitOAuth: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 }),
  };
});

function consentForm(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function consent(fields: Record<string, string>) {
  const { submitMcpConsent } = await import("@/actions/mcp-oauth");
  try {
    const error = await submitMcpConsent(null, consentForm(fields));
    return { error, redirect: null as URL | null };
  } catch (e) {
    if (e instanceof RedirectSignal) return { error: null, redirect: new URL(e.url) };
    throw e;
  }
}

function tokenRequest(data: Record<string, string>) {
  return new Request("http://localhost/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data).toString(),
  });
}

describe("registered kmc_ client: consent -> code -> token", () => {
  beforeEach(() => {
    codes.clear();
    vi.stubGlobal("fetch", vi.fn()); // any CIMD fetch here would be a bug
  });

  it("issues tokens without fetching any metadata document", async () => {
    const { generateCodeVerifier, codeChallengeS256 } =
      await import("@/lib/mcp/oauth");
    const verifier = generateCodeVerifier();
    const approved = await consent({
      decision: "approve",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      code_challenge: codeChallengeS256(verifier),
      resource: RESOURCE,
      state: "s1",
    });
    expect(approved.error).toBeNull();
    const target = approved.redirect;
    if (!target) throw new Error("consent did not redirect");
    expect(target.origin + target.pathname).toBe(REDIRECT);
    expect(target.searchParams.get("state")).toBe("s1");
    expect(target.searchParams.get("iss")).toBe("https://mail.example");
    const code = target.searchParams.get("code");
    expect(code).toBeTruthy();

    const { POST } = await import("@/app/api/oauth/token/route");
    const res = await POST(
      tokenRequest({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: REDIRECT,
        client_id: CLIENT_ID,
        code_verifier: verifier,
        resource: RESOURCE,
      }) as never,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).access_token).toBe("access");
    const tokens = await import("@/lib/mcp/tokens");
    expect(tokens.issueMcpTokens).toHaveBeenCalledWith({
      userId: "u1",
      clientId: CLIENT_ID,
      clientName: "Grok Bot",
      resource: RESOURCE,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(codes.size).toBe(0); // one-time code consumed
  });

  it("refuses a redirect_uri the registered client did not list", async () => {
    const result = await consent({
      decision: "approve",
      client_id: CLIENT_ID,
      redirect_uri: "https://evil.example/cb",
      code_challenge: "chal",
      resource: RESOURCE,
    });
    expect(result.redirect).toBeNull();
    expect(result.error).toMatch(/redirect that is not allowed/);
    expect(codes.size).toBe(0);
  });

  it("refuses an unknown kmc_ id and never redirects", async () => {
    const result = await consent({
      decision: "approve",
      client_id: "kmc_unknown",
      redirect_uri: REDIRECT,
      code_challenge: "chal",
      resource: RESOURCE,
    });
    expect(result.redirect).toBeNull();
    expect(result.error).toMatch(/could not be verified/);
  });

  it("rejects a token exchange whose client_id does not match the code", async () => {
    const { generateCodeVerifier, codeChallengeS256 } =
      await import("@/lib/mcp/oauth");
    const verifier = generateCodeVerifier();
    const approved = await consent({
      decision: "approve",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      code_challenge: codeChallengeS256(verifier),
      resource: RESOURCE,
    });
    const code = approved.redirect!.searchParams.get("code")!;
    const { POST } = await import("@/app/api/oauth/token/route");
    const res = await POST(
      tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: "https://ok.example/c.json",
        code_verifier: verifier,
        resource: RESOURCE,
      }) as never,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_grant");
  });
});
