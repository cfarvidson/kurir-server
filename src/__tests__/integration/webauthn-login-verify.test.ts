/**
 * Integration tests for POST /api/auth/webauthn/login/verify
 *
 * Security-critical endpoint:
 * - Must validate session cookie
 * - Must consume challenge (single-use)
 * - Must look up passkey by credentialId
 * - Must verify signature and counter
 * - Must update counter after verification
 * - Must issue session JWT
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@simplewebauthn/server", () => ({
  verifyAuthenticationResponse: vi.fn(),
}));

vi.mock("@simplewebauthn/server/helpers", () => ({
  isoBase64URL: {
    toBuffer: vi.fn().mockImplementation((s: string) => Buffer.from(s, "base64url")),
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    passkey: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("next-auth/jwt", () => ({
  encode: vi.fn().mockResolvedValue("mock-jwt-token"),
}));

vi.mock("@/lib/webauthn-challenge-store", () => ({
  consumeChallenge: vi.fn(),
}));

// NextRequest requires cookies.get()
function makeNextRequest(body: unknown, sessionKey?: string): any {
  return {
    cookies: {
      get: (name: string) => {
        if (name === "wa_auth_session" && sessionKey) {
          return { value: sessionKey };
        }
        return undefined;
      },
    },
    json: async () => body,
  };
}

const mockPasskey = {
  id: "pk-1",
  credentialId: "known-cred-id",
  publicKey: "dGVzdC1rZXk=",
  counter: BigInt(10),
  userId: "user-1",
  deviceType: "multiDevice",
  backedUp: true,
  transports: ["internal"],
  friendlyName: null,
  createdAt: new Date(),
  user: { id: "user-1" },
};

describe("POST /api/auth/webauthn/login/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_SECRET = "test-secret";
  });

  it("returns 400 when auth session cookie is missing", async () => {
    const { POST } = await import("@/app/api/auth/webauthn/login/verify/route");
    const req = makeNextRequest({ id: "cred-id" }); // no cookie
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("authentication session");
  });

  it("returns 400 when challenge is expired or not found", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue(null);

    const { POST } = await import("@/app/api/auth/webauthn/login/verify/route");
    const req = makeNextRequest({ id: "cred-id" }, "session-key");
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Challenge expired");
  });

  it("returns 404 when credential is not registered", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findUnique).mockResolvedValue(null);

    const { POST } = await import("@/app/api/auth/webauthn/login/verify/route");
    const req = makeNextRequest({ id: "unknown-cred-id" }, "session-key");
    const response = await POST(req);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("Passkey not found");
  });

  it("returns 401 when authentication verification fails", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findUnique).mockResolvedValue(mockPasskey as any);

    const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: false,
      authenticationInfo: {} as any,
    } as any);

    const { POST } = await import("@/app/api/auth/webauthn/login/verify/route");
    const req = makeNextRequest({ id: "known-cred-id" }, "session-key");
    const response = await POST(req);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toContain("Authentication not verified");
  });

  it("returns 400 when verifyAuthenticationResponse throws (replay attack)", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findUnique).mockResolvedValue(mockPasskey as any);

    const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
    vi.mocked(verifyAuthenticationResponse).mockRejectedValue(
      new Error("Counter did not increment")
    );

    const { POST } = await import("@/app/api/auth/webauthn/login/verify/route");
    const req = makeNextRequest({ id: "known-cred-id" }, "session-key");
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Verification failed");
  });

  it("updates counter in database after successful verification", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findUnique).mockResolvedValue(mockPasskey as any);
    vi.mocked(db.passkey.update).mockResolvedValue({} as any);

    const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: {
        newCounter: 11,
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    } as any);

    const { POST } = await import("@/app/api/auth/webauthn/login/verify/route");
    const req = makeNextRequest({ id: "known-cred-id" }, "session-key");
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(db.passkey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ counter: BigInt(11) }),
      })
    );
  });

  it("looks up passkey by credentialId from the request body", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findUnique).mockResolvedValue(null);

    const { POST } = await import("@/app/api/auth/webauthn/login/verify/route");
    const req = makeNextRequest({ id: "specific-cred-id" }, "session-key");
    await POST(req);

    expect(db.passkey.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { credentialId: "specific-cred-id" },
      })
    );
  });

  it("issues a session cookie linked to the passkey's userId", async () => {
    const { consumeChallenge } = await import("@/lib/webauthn-challenge-store");
    vi.mocked(consumeChallenge).mockReturnValue("valid-challenge");

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findUnique).mockResolvedValue({
      ...mockPasskey,
      userId: "owner-user-id",
    } as any);
    vi.mocked(db.passkey.update).mockResolvedValue({} as any);

    const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: {
        newCounter: 11,
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    } as any);

    const { encode } = await import("next-auth/jwt");

    const { POST } = await import("@/app/api/auth/webauthn/login/verify/route");
    const req = makeNextRequest({ id: "known-cred-id" }, "session-key");
    const response = await POST(req);

    expect(response.status).toBe(200);
    // The JWT should encode the userId from the passkey's owner
    expect(encode).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.objectContaining({ id: "owner-user-id" }),
      })
    );
  });
});
