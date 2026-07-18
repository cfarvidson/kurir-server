/**
 * Integration tests for /api/mobile/push/subscribe — APNs token registration.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    pushSubscription: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/mobile/auth", () => ({
  requireMobileAuth: vi.fn(),
}));

function makeRequest(body: unknown) {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as any;
}

async function mockAuthed() {
  const { requireMobileAuth } = await import("@/lib/mobile/auth");
  vi.mocked(requireMobileAuth).mockResolvedValue({ userId: "user-1" });
}

const TOKEN = "a1b2c3d4e5f60718a1b2c3d4e5f60718";

describe("POST /api/mobile/push/subscribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without bearer auth", async () => {
    const { requireMobileAuth } = await import("@/lib/mobile/auth");
    vi.mocked(requireMobileAuth).mockResolvedValue(null);

    const { POST } = await import("@/app/api/mobile/push/subscribe/route");
    const res = await POST(makeRequest({ deviceToken: TOKEN }));
    expect(res.status).toBe(401);
  });

  it("rejects non-hex device tokens", async () => {
    await mockAuthed();
    const { POST } = await import("@/app/api/mobile/push/subscribe/route");
    const res = await POST(makeRequest({ deviceToken: "not-hex!!" }));
    expect(res.status).toBe(400);
  });

  it("upserts an ios subscription with apns-prefixed endpoint", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.pushSubscription.upsert).mockResolvedValue({} as any);

    const { POST } = await import("@/app/api/mobile/push/subscribe/route");
    const res = await POST(makeRequest({ deviceToken: TOKEN.toUpperCase() }));
    expect(res.status).toBe(200);

    expect(db.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endpoint: `apns:${TOKEN}` },
        create: expect.objectContaining({
          platform: "ios",
          userId: "user-1",
        }),
        // Re-login on the same device moves the token to the new user
        update: { userId: "user-1" },
      }),
    );
  });

  it("DELETE removes only the caller's subscription", async () => {
    await mockAuthed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.pushSubscription.deleteMany).mockResolvedValue({ count: 1 });

    const { DELETE } = await import("@/app/api/mobile/push/subscribe/route");
    const res = await DELETE(makeRequest({ deviceToken: TOKEN }));
    expect(res.status).toBe(200);

    expect(db.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: `apns:${TOKEN}`, userId: "user-1" },
    });
  });
});
