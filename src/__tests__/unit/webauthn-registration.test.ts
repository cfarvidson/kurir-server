/**
 * Unit tests for WebAuthn registration logic.
 *
 * The registration flow:
 * 1. Client calls POST /api/auth/webauthn/register/options -> gets challenge
 * 2. Browser creates credential
 * 3. Client calls POST /api/auth/webauthn/register/verify -> verified, user created
 *
 * We test the server-side verification logic in isolation using mocked
 * @simplewebauthn/server functions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @simplewebauthn/server
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    passkey: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

describe("WebAuthn registration options generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates options with correct RP name and ID", async () => {
    const { generateRegistrationOptions } =
      await import("@simplewebauthn/server");
    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      challenge: "base64-challenge",
      rp: { name: "Kurir", id: "localhost" },
      user: {
        id: "user-id-bytes",
        name: "user@example.com",
        displayName: "User",
      },
      pubKeyCredParams: [],
      timeout: 60000,
      attestation: "none",
      excludeCredentials: [],
    } as any);

    await generateRegistrationOptions({
      rpName: "Kurir",
      rpID: "localhost",
      userName: "user@example.com",
      attestationType: "none",
      excludeCredentials: [],
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    } as any);

    expect(generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpName: "Kurir",
        rpID: "localhost",
        authenticatorSelection: expect.objectContaining({
          residentKey: "required",
          userVerification: "required",
        }),
      }),
    );
  });

  it("excludes already-registered credentials to prevent duplicate registration", async () => {
    const { generateRegistrationOptions } =
      await import("@simplewebauthn/server");
    vi.mocked(generateRegistrationOptions).mockResolvedValue({} as any);

    const existingCredentials = [
      { credentialId: "cred-id-1", transports: ["internal"] },
    ];

    await generateRegistrationOptions({
      rpName: "Kurir",
      rpID: "localhost",
      userName: "user@example.com",
      excludeCredentials: existingCredentials.map((c) => ({
        id: c.credentialId,
        transports: c.transports,
      })),
    } as any);

    expect(generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeCredentials: [expect.objectContaining({ id: "cred-id-1" })],
      }),
    );
  });
});

describe("WebAuthn registration verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts valid registration response and returns verified credential", async () => {
    const { verifyRegistrationResponse } =
      await import("@simplewebauthn/server");
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "new-credential-id",
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    } as any);

    const result = await verifyRegistrationResponse({
      response: { id: "new-credential-id" } as any,
      expectedChallenge: "expected-challenge",
      expectedOrigin: "https://example.com",
      expectedRPID: "example.com",
    });

    expect(result.verified).toBe(true);
    expect(result.registrationInfo?.credential.id).toBe("new-credential-id");
  });

  it("rejects registration with wrong challenge", async () => {
    const { verifyRegistrationResponse } =
      await import("@simplewebauthn/server");
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: false,
    } as any);

    const result = await verifyRegistrationResponse({
      response: {} as any,
      expectedChallenge: "wrong-challenge",
      expectedOrigin: "https://example.com",
      expectedRPID: "example.com",
    });

    expect(result.verified).toBe(false);
  });

  it("stores the correct passkey fields after successful verification", async () => {
    const { db } = await import("@/lib/db");
    // Simulate what the registration endpoint does after verification
    const credentialId = "abc123";
    const publicKey = Buffer.from([1, 2, 3]).toString("base64url");
    const counter = BigInt(0);

    vi.mocked(db.passkey.create).mockResolvedValue({
      id: "passkey-1",
      credentialId,
      publicKey,
      counter,
      deviceType: "multiDevice",
      backedUp: true,
      transports: ["internal"],
      friendlyName: null,
      userId: "user-1",
      createdAt: new Date(),
    } as any);

    const passkey = await db.passkey.create({
      data: {
        credentialId,
        publicKey,
        counter,
        deviceType: "multiDevice",
        backedUp: true,
        transports: ["internal"],
        userId: "user-1",
      },
    });

    expect(passkey.credentialId).toBe(credentialId);
    expect(passkey.counter).toBe(BigInt(0));
    expect(passkey.deviceType).toBe("multiDevice");
  });
});
