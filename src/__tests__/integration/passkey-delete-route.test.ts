/**
 * Integration tests for DELETE /api/auth/webauthn/passkeys/[id]
 *
 * Covers:
 * - Auth guard (401 when no session)
 * - 404 when passkey not found or belongs to different user
 * - 409 last-passkey guard: cannot delete the last passkey
 * - 200 successful deletion when multiple passkeys exist
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    passkey: {
      findFirst: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

function makeRequest(method: string): any {
  return {
    cookies: { get: vi.fn() },
    json: async () => ({}),
  };
}

describe("DELETE /api/auth/webauthn/passkeys/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null);

    const { DELETE } = await import(
      "@/app/api/auth/webauthn/passkeys/[id]/route"
    );
    const response = await DELETE(makeRequest("DELETE"), {
      params: Promise.resolve({ id: "passkey-1" }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 404 when passkey does not exist", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findFirst).mockResolvedValue(null);

    const { DELETE } = await import(
      "@/app/api/auth/webauthn/passkeys/[id]/route"
    );
    const response = await DELETE(makeRequest("DELETE"), {
      params: Promise.resolve({ id: "nonexistent-passkey" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("not found");
  });

  it("returns 404 when passkey belongs to a different user", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "attacker" } } as any);

    const { db } = await import("@/lib/db");
    // findFirst with WHERE id + userId returns null because user doesn't own it
    vi.mocked(db.passkey.findFirst).mockResolvedValue(null);

    const { DELETE } = await import(
      "@/app/api/auth/webauthn/passkeys/[id]/route"
    );
    const response = await DELETE(makeRequest("DELETE"), {
      params: Promise.resolve({ id: "other-users-passkey" }),
    });

    expect(response.status).toBe(404);
  });

  it("verifies passkey ownership by querying with both id and userId", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findFirst).mockResolvedValue(null);

    const { DELETE } = await import(
      "@/app/api/auth/webauthn/passkeys/[id]/route"
    );
    await DELETE(makeRequest("DELETE"), {
      params: Promise.resolve({ id: "pk-123" }),
    });

    expect(db.passkey.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pk-123", userId: "user-1" },
      })
    );
  });

  it("returns 409 when trying to delete the last passkey", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findFirst).mockResolvedValue({ id: "pk-1" } as any);
    // Transaction callback receives a tx where count returns 1 (last passkey)
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        passkey: {
          count: vi.fn().mockResolvedValue(1),
          delete: vi.fn(),
        },
      };
      return fn(tx);
    });

    const { DELETE } = await import(
      "@/app/api/auth/webauthn/passkeys/[id]/route"
    );
    const response = await DELETE(makeRequest("DELETE"), {
      params: Promise.resolve({ id: "pk-1" }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("last passkey");
  });

  it("does not delete when only one passkey remains", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findFirst).mockResolvedValue({ id: "pk-1" } as any);
    const mockDelete = vi.fn();
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        passkey: {
          count: vi.fn().mockResolvedValue(1),
          delete: mockDelete,
        },
      };
      return fn(tx);
    });

    const { DELETE } = await import(
      "@/app/api/auth/webauthn/passkeys/[id]/route"
    );
    await DELETE(makeRequest("DELETE"), {
      params: Promise.resolve({ id: "pk-1" }),
    });

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes passkey and returns 200 when user has multiple passkeys", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findFirst).mockResolvedValue({ id: "pk-2" } as any);
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        passkey: {
          count: vi.fn().mockResolvedValue(2),
          delete: vi.fn().mockResolvedValue({} as any),
        },
      };
      return fn(tx);
    });

    const { DELETE } = await import(
      "@/app/api/auth/webauthn/passkeys/[id]/route"
    );
    const response = await DELETE(makeRequest("DELETE"), {
      params: Promise.resolve({ id: "pk-2" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("deletes the correct passkey by id", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findFirst).mockResolvedValue({ id: "pk-old" } as any);
    const mockDelete = vi.fn().mockResolvedValue({} as any);
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        passkey: {
          count: vi.fn().mockResolvedValue(3),
          delete: mockDelete,
        },
      };
      return fn(tx);
    });

    const { DELETE } = await import(
      "@/app/api/auth/webauthn/passkeys/[id]/route"
    );
    await DELETE(makeRequest("DELETE"), {
      params: Promise.resolve({ id: "pk-old" }),
    });

    expect(mockDelete).toHaveBeenCalledWith({
      where: { id: "pk-old" },
    });
  });

  it("count of exactly 2 is allowed to delete (leaves 1)", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.passkey.findFirst).mockResolvedValue({ id: "pk-2" } as any);
    const mockDelete = vi.fn().mockResolvedValue({} as any);
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        passkey: {
          count: vi.fn().mockResolvedValue(2),
          delete: mockDelete,
        },
      };
      return fn(tx);
    });

    const { DELETE } = await import(
      "@/app/api/auth/webauthn/passkeys/[id]/route"
    );
    const response = await DELETE(makeRequest("DELETE"), {
      params: Promise.resolve({ id: "pk-2" }),
    });

    // Should succeed, leaving user with 1 passkey
    expect(response.status).toBe(200);
    expect(mockDelete).toHaveBeenCalled();
  });
});
