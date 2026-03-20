/**
 * Integration tests for the "add passkey to existing user" flow:
 *
 * POST /api/auth/webauthn/register/options?addPasskey=true
 *   - Requires active session (401 otherwise)
 *   - Fetches existing passkeys to build excludeCredentials list
 *   - Returns options JSON and sets wa_reg_session cookie
 *
 * POST /api/auth/webauthn/register/verify?addPasskey=true
 *   - Requires active session (401 otherwise)
 *   - Validates challenge cookie and consumes it
 *   - Creates only a Passkey record (NOT a new User)
 *   - Clears the reg session cookie on success
 *   - Does NOT issue a new session JWT (user is already signed in)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks for register/options ────────────────────────────────────────────

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({
    challenge: "mock-challenge",
    user: { id: "mock-id", name: "user", displayName: "" },
    excludeCredentials: [],
  }),
  verifyRegistrationResponse: vi.fn(),
}));

vi.mock("@simplewebauthn/server/helpers", () => ({
  isoBase64URL: {
    fromBuffer: vi.fn().mockImplementation((buf: Buffer) => buf.toString("base64url")),
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    passkey: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    user: { create: vi.fn() },
    systemSettings: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/webauthn-challenge-store", () => ({
  setChallenge: vi.fn(),
  consumeChallenge: vi.fn(),
}));

vi.mock("next-auth/jwt", () => ({
  encode: vi.fn().mockResolvedValue("mock-jwt-token"),
}));

/**
 * Build a minimal NextRequest-compatible mock with cookie support.
 * For addPasskey routes the request URL must include ?addPasskey=true.
 */
function makeRequest(body: unknown, sessionKey?: string, query = ""): any {
  return {
    url: `http://localhost/api/auth/webauthn/register/options${query}`,
    cookies: {
      get: (name: string) => {
        if (name === "wa_reg_session" && sessionKey) {
          return { value: sessionKey };
        }
        return undefined;
      },
    },
    json: async () => body,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/auth/webauthn/register/options?addPasskey=true
// ──────────────────────────────────────────────────────────────────────────

describe("POST /api/auth/webauthn/register/options?addPasskey=true", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null);

    const { POST } = await import(
      "@/app/api/auth/webauthn/register/options/route"
    );
    const req = makeRequest({}, undefined, "?addPasskey=true");
    const response = await POST(req);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns options JSON on success", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findMany).mockResolvedValue([]);

    const { POST } = await import(
      "@/app/api/auth/webauthn/register/options/route"
    );
    const req = makeRequest({}, undefined, "?addPasskey=true");
    const response = await POST(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("options");
  });

  it("sets wa_reg_session cookie on success", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findMany).mockResolvedValue([]);

    const { POST } = await import(
      "@/app/api/auth/webauthn/register/options/route"
    );
    const req = makeRequest({}, undefined, "?addPasskey=true");
    const response = await POST(req);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("wa_reg_session");
  });

  it("fetches existing passkeys to build excludeCredentials list", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findMany).mockResolvedValue([
      { credentialId: "existing-cred-id", transports: ["internal"] },
    ] as any);

    const { generateRegistrationOptions } = await import("@simplewebauthn/server");
    const { POST } = await import(
      "@/app/api/auth/webauthn/register/options/route"
    );
    const req = makeRequest({}, undefined, "?addPasskey=true");
    await POST(req);

    // Check that generateRegistrationOptions was called with excludeCredentials
    const callArgs = vi.mocked(generateRegistrationOptions).mock.calls[0][0];
    expect(callArgs.excludeCredentials).toHaveLength(1);
    expect(callArgs.excludeCredentials![0].id).toBe("existing-cred-id");
  });

  it("fetches passkeys filtered by the current user's id", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-42" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findMany).mockResolvedValue([]);

    const { POST } = await import(
      "@/app/api/auth/webauthn/register/options/route"
    );
    const req = makeRequest({}, undefined, "?addPasskey=true");
    await POST(req);

    expect(db.passkey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-42" },
      })
    );
  });

  it("does NOT require session when addPasskey param is absent (new user flow)", async () => {
    // Without ?addPasskey=true, the route generates options for a new user
    // and does not call auth(). This test ensures the two code paths are distinct.
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findMany).mockResolvedValue([]);
    // New user flow checks systemSettings for signup gating
    vi.mocked(db.systemSettings.findUnique).mockResolvedValue(null);

    const { POST } = await import(
      "@/app/api/auth/webauthn/register/options/route"
    );
    const req = makeRequest({ displayName: "Alice" }); // no query string
    const response = await POST(req);

    // Should succeed for a new user (no session required)
    expect(response.status).toBe(200);
    expect(auth).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// POST /api/auth/webauthn/register/verify?addPasskey=true
// ──────────────────────────────────────────────────────────────────────────

describe("POST /api/auth/webauthn/register/verify?addPasskey=true", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_SECRET = "test-secret";
  });

  function makeVerifyRequest(body: unknown, sessionKey?: string): any {
    return {
      url: "http://localhost/api/auth/webauthn/register/verify?addPasskey=true",
      cookies: {
        get: (name: string) => {
          if (name === "wa_reg_session" && sessionKey) {
            return { value: sessionKey };
          }
          return undefined;
        },
      },
      json: async () => body,
    };
  }

  it("returns 400 when session cookie is missing", async () => {
    const { POST } = await import(
      "@/app/api/auth/webauthn/register/verify/route"
    );
    const req = makeVerifyRequest({ id: "cred" }); // no cookie
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("registration session");
  });

  it("returns 400 when challenge is expired", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue(null);

    const { POST } = await import(
      "@/app/api/auth/webauthn/register/verify/route"
    );
    const req = makeVerifyRequest({}, "session-key");
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Challenge expired");
  });

  it("returns 401 when session is missing during addPasskey verification", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred-id",
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    } as any);

    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null); // no session!

    const { POST } = await import(
      "@/app/api/auth/webauthn/register/verify/route"
    );
    const req = makeVerifyRequest({ credential: { id: "cred-id" } }, "session-key");
    const response = await POST(req);

    expect(response.status).toBe(401);
  });

  it("creates only a Passkey record (not a new User) when addPasskey=true", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "new-cred-id",
          publicKey: new Uint8Array([4, 5, 6]),
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    } as any);

    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.create).mockResolvedValue({} as any);

    const { POST } = await import(
      "@/app/api/auth/webauthn/register/verify/route"
    );
    const req = makeVerifyRequest({ credential: { id: "new-cred-id" } }, "session-key");
    await POST(req);

    // Passkey should be created
    expect(db.passkey.create).toHaveBeenCalled();
    // No new User should be created
    expect(db.user.create).not.toHaveBeenCalled();
    // No DB transaction (that's the new-user path)
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("creates passkey associated with the authenticated user", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred-abc",
          publicKey: new Uint8Array([7, 8, 9]),
          counter: 5,
          transports: ["usb"],
        },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    } as any);

    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-99" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.create).mockResolvedValue({} as any);

    const { POST } = await import(
      "@/app/api/auth/webauthn/register/verify/route"
    );
    const req = makeVerifyRequest({ credential: {} }, "session-key");
    await POST(req);

    expect(db.passkey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-99" }),
      })
    );
  });

  it("returns 200 on success", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred-x",
          publicKey: new Uint8Array([]),
          counter: 0,
          transports: [],
        },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: false,
      },
    } as any);

    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.create).mockResolvedValue({} as any);

    const { POST } = await import(
      "@/app/api/auth/webauthn/register/verify/route"
    );
    const req = makeVerifyRequest({ credential: {} }, "session-key");
    const response = await POST(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("does NOT issue a new JWT session cookie (user already has a session)", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred-y",
          publicKey: new Uint8Array([]),
          counter: 0,
          transports: [],
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    } as any);

    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.create).mockResolvedValue({} as any);

    const { encode } = await import("next-auth/jwt");

    const { POST } = await import(
      "@/app/api/auth/webauthn/register/verify/route"
    );
    const req = makeVerifyRequest({ credential: {} }, "session-key");
    await POST(req);

    // encode() should NOT be called — no new session needed
    expect(encode).not.toHaveBeenCalled();
  });

  it("clears the wa_reg_session cookie on success", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred-z",
          publicKey: new Uint8Array([]),
          counter: 0,
          transports: [],
        },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    } as any);

    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.create).mockResolvedValue({} as any);

    const { POST } = await import(
      "@/app/api/auth/webauthn/register/verify/route"
    );
    const req = makeVerifyRequest({ credential: {} }, "session-key");
    const response = await POST(req);

    // wa_reg_session should be cleared (maxAge=0)
    const allCookies = response.headers.getSetCookie?.() ?? [];
    const regClearedCookie = allCookies.find(
      (c: string) => c.startsWith("wa_reg_session=") && c.includes("Max-Age=0")
    );
    expect(regClearedCookie).toBeTruthy();
  });

  it("accepts credential wrapped in { credential } (as sent by PasskeysList component)", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "wrapped-cred",
          publicKey: new Uint8Array([1]),
          counter: 0,
          transports: [],
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    } as any);

    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.create).mockResolvedValue({} as any);

    const { POST } = await import(
      "@/app/api/auth/webauthn/register/verify/route"
    );
    // Wrapped form: { credential: <RegistrationResponseJSON> }
    const req = makeVerifyRequest(
      { credential: { id: "wrapped-cred", response: {} } },
      "session-key"
    );
    const response = await POST(req);

    expect(response.status).toBe(200);
  });
});
