/**
 * Integration tests for POST /api/auth/webauthn/register/verify
 *
 * This is the critical security endpoint that:
 * 1. Validates the session cookie exists
 * 2. Consumes the challenge (single-use)
 * 3. Verifies the WebAuthn response
 * 4. Creates User + Passkey records
 * 5. Issues a session JWT
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@simplewebauthn/server", () => ({
  verifyRegistrationResponse: vi.fn(),
}));

vi.mock("@simplewebauthn/server/helpers", () => ({
  isoBase64URL: {
    fromBuffer: vi
      .fn()
      .mockImplementation((buf: Buffer) => buf.toString("base64url")),
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
    user: { create: vi.fn(), count: vi.fn() },
    passkey: { create: vi.fn() },
    systemSettings: { findUnique: vi.fn() },
  },
}));

vi.mock("next-auth/jwt", () => ({
  encode: vi.fn().mockResolvedValue("mock-jwt-token"),
}));

vi.mock("@/lib/webauthn-challenge-store", () => ({
  setChallenge: vi.fn(),
  consumeChallenge: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

// NextRequest requires a special cookies property with a .get() method
function makeNextRequest(body: unknown, sessionKey?: string, query = ""): any {
  const request = {
    url: `http://localhost/api/auth/webauthn/register/verify${query}`,
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
  return request;
}

describe("POST /api/auth/webauthn/register/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_SECRET = "test-secret";
  });

  it("returns 400 when session cookie is missing", async () => {
    const { POST } =
      await import("@/app/api/auth/webauthn/register/verify/route");
    const req = makeNextRequest({ id: "cred-id" }); // no cookie
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("registration session");
  });

  it("returns 400 when challenge is expired or not found", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue(null); // expired/not found

    const { POST } =
      await import("@/app/api/auth/webauthn/register/verify/route");
    const req = makeNextRequest({ id: "cred-id" }, "session-key-123");
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Challenge expired");
  });

  it("returns 400 when WebAuthn verification fails", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { verifyRegistrationResponse } =
      await import("@simplewebauthn/server");
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: false,
    } as any);

    const { POST } =
      await import("@/app/api/auth/webauthn/register/verify/route");
    const req = makeNextRequest({ id: "cred-id", response: {} }, "session-key");
    const response = await POST(req);

    expect(response.status).toBe(400);
  });

  it("returns 400 when verifyRegistrationResponse throws", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { verifyRegistrationResponse } =
      await import("@simplewebauthn/server");
    vi.mocked(verifyRegistrationResponse).mockRejectedValue(
      new Error("Bad authenticator data"),
    );

    const { POST } =
      await import("@/app/api/auth/webauthn/register/verify/route");
    const req = makeNextRequest({ id: "cred-id", response: {} }, "session-key");
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Verification failed");
  });

  it("creates user and passkey on successful registration", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { verifyRegistrationResponse } =
      await import("@simplewebauthn/server");
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "new-cred-id",
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    } as any);

    const { db } = await import("@/lib/db");
    const mockUser = { id: "new-user-id", role: "ADMIN" };
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        systemSettings: { findUnique: vi.fn().mockResolvedValue(null) },
        user: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockResolvedValue(mockUser),
        },
        passkey: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    const { POST } =
      await import("@/app/api/auth/webauthn/register/verify/route");
    const req = makeNextRequest(
      { id: "new-cred-id", response: {} },
      "session-key",
    );
    const response = await POST(req);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("sets session cookie on successful registration", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { verifyRegistrationResponse } =
      await import("@simplewebauthn/server");
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "new-cred-id",
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: [],
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        systemSettings: { findUnique: vi.fn().mockResolvedValue(null) },
        user: {
          count: vi.fn().mockResolvedValue(0),
          create: vi
            .fn()
            .mockResolvedValue({ id: "new-user-id", role: "ADMIN" }),
        },
        passkey: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    const { POST } =
      await import("@/app/api/auth/webauthn/register/verify/route");
    const req = makeNextRequest(
      { id: "new-cred-id", response: {} },
      "session-key",
    );
    const response = await POST(req);

    const setCookieHeader = response.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toBeTruthy();
  });

  it("clears the registration session cookie after success", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { verifyRegistrationResponse } =
      await import("@simplewebauthn/server");
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred",
          publicKey: new Uint8Array([]),
          counter: 0,
          transports: [],
        },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        systemSettings: { findUnique: vi.fn().mockResolvedValue(null) },
        user: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockResolvedValue({ id: "u1", role: "ADMIN" }),
        },
        passkey: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    const { POST } =
      await import("@/app/api/auth/webauthn/register/verify/route");
    const req = makeNextRequest({}, "session-key");
    const response = await POST(req);

    // Check that wa_reg_session is cleared (maxAge=0)
    const allCookies = response.headers.getSetCookie?.() ?? [];
    const regSessionClearedCookie = allCookies.find(
      (c: string) => c.startsWith("wa_reg_session=") && c.includes("Max-Age=0"),
    );
    expect(regSessionClearedCookie).toBeTruthy();
  });
});
