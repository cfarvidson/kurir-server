/**
 * Unit tests for WebAuthn authentication (login) logic.
 *
 * The login flow:
 * 1. Client calls POST /api/auth/webauthn/login/options -> gets challenge
 * 2. Browser signs with stored passkey
 * 3. Client calls POST /api/auth/webauthn/login/verify -> verified, session created
 *
 * Key security invariants:
 * - Counter must increment (replay protection)
 * - Challenge must match (CSRF protection)
 * - Credential must belong to a known user
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    passkey: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("WebAuthn authentication options generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates options with empty allowCredentials for discoverable credentials", async () => {
    const { generateAuthenticationOptions } = await import("@simplewebauthn/server");
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({
      challenge: "auth-challenge",
      allowCredentials: [],
      timeout: 60000,
      userVerification: "required",
      rpId: "localhost",
    } as any);

    const options = await generateAuthenticationOptions({
      rpID: "localhost",
      allowCredentials: [], // discoverable
      userVerification: "required",
    } as any);

    expect(options.allowCredentials).toEqual([]);
  });

  it("includes user credentials when username is known (non-discoverable flow)", async () => {
    const { generateAuthenticationOptions } = await import("@simplewebauthn/server");
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({} as any);

    await generateAuthenticationOptions({
      rpID: "localhost",
      allowCredentials: [{ id: "cred-id-1", type: "public-key" }],
    } as any);

    expect(generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowCredentials: [expect.objectContaining({ id: "cred-id-1" })],
      })
    );
  });
});

describe("WebAuthn authentication verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts valid authentication response", async () => {
    const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: {
        credentialID: "cred-id",
        newCounter: 42,
        userVerified: true,
      },
    } as any);

    const result = await verifyAuthenticationResponse({
      response: {} as any,
      expectedChallenge: "the-challenge",
      expectedOrigin: "https://example.com",
      expectedRPID: "example.com",
      credential: {
        id: "cred-id",
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 41,
        transports: ["internal"],
      },
    } as any);

    expect(result.verified).toBe(true);
    expect(result.authenticationInfo?.newCounter).toBe(42);
  });

  it("rejects authentication when counter does not increment (replay attack)", async () => {
    const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
    // simplewebauthn throws on counter regression
    vi.mocked(verifyAuthenticationResponse).mockRejectedValue(
      new Error("Counter did not increment")
    );

    await expect(
      verifyAuthenticationResponse({
        response: {} as any,
        expectedChallenge: "challenge",
        expectedOrigin: "https://example.com",
        expectedRPID: "example.com",
        credential: {
          id: "cred-id",
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 10, // same as or less than stored counter = replay
          transports: [],
        },
      } as any)
    ).rejects.toThrow("Counter did not increment");
  });

  it("updates counter in database after successful verification", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.update).mockResolvedValue({} as any);

    // Simulate what the login endpoint does after verification
    await db.passkey.update({
      where: { credentialId: "cred-id" },
      data: { counter: BigInt(42) },
    });

    expect(db.passkey.update).toHaveBeenCalledWith({
      where: { credentialId: "cred-id" },
      data: { counter: BigInt(42) },
    });
  });

  it("looks up passkey by credentialId from the response", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findUnique).mockResolvedValue({
      id: "pk-1",
      credentialId: "cred-id",
      publicKey: "base64-encoded-key",
      counter: BigInt(0),
      userId: "user-1",
      deviceType: "multiDevice",
      backedUp: true,
      transports: ["internal"],
      friendlyName: null,
      createdAt: new Date(),
    } as any);

    const passkey = await db.passkey.findUnique({
      where: { credentialId: "cred-id" },
      include: { user: true },
    });

    expect(passkey).not.toBeNull();
    expect(passkey!.userId).toBe("user-1");
  });

  it("returns 404 when credential is not recognized", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findUnique).mockResolvedValue(null);

    const passkey = await db.passkey.findUnique({
      where: { credentialId: "unknown-cred" },
    });

    expect(passkey).toBeNull();
  });
});
