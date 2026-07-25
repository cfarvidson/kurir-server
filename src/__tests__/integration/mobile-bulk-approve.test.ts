/**
 * Integration tests for POST /api/mobile/screener/bulk-approve — the one-shot
 * "approve senders older than N days" endpoint (not an offline-queue action).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mail/mutations", () => ({
  bulkApproveOldSendersForUser: vi.fn(),
}));

vi.mock("@/lib/mobile/auth", () => ({
  requireMobileAuth: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitUser: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 100, retryAfter: 0 }),
  };
});

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

describe("POST /api/mobile/screener/bulk-approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without valid bearer auth", async () => {
    const { requireMobileAuth } = await import("@/lib/mobile/auth");
    vi.mocked(requireMobileAuth).mockResolvedValue(null);

    const { POST } = await import(
      "@/app/api/mobile/screener/bulk-approve/route"
    );
    const res = await POST(makeRequest({ days: 90 }));
    expect(res.status).toBe(401);
  });

  it("defaults to 90 days and returns the approved count", async () => {
    await mockAuthed();
    const mutations = await import("@/lib/mail/mutations");
    vi.mocked(mutations.bulkApproveOldSendersForUser).mockResolvedValue(7);

    const { POST } = await import(
      "@/app/api/mobile/screener/bulk-approve/route"
    );
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(200);
    expect(mutations.bulkApproveOldSendersForUser).toHaveBeenCalledWith(
      "user-1",
      90,
    );
    const body = await res.json();
    expect(body).toEqual({ approved: 7 });
  });

  it("passes an explicit days value through", async () => {
    await mockAuthed();
    const mutations = await import("@/lib/mail/mutations");
    vi.mocked(mutations.bulkApproveOldSendersForUser).mockResolvedValue(2);

    const { POST } = await import(
      "@/app/api/mobile/screener/bulk-approve/route"
    );
    const res = await POST(makeRequest({ days: 30 }));

    expect(res.status).toBe(200);
    expect(mutations.bulkApproveOldSendersForUser).toHaveBeenCalledWith(
      "user-1",
      30,
    );
    const body = await res.json();
    expect(body).toEqual({ approved: 2 });
  });

  it("rejects an out-of-range days value", async () => {
    await mockAuthed();

    const { POST } = await import(
      "@/app/api/mobile/screener/bulk-approve/route"
    );
    const res = await POST(makeRequest({ days: 0 }));
    expect(res.status).toBe(400);

    const res2 = await POST(makeRequest({ days: 400 }));
    expect(res2.status).toBe(400);
  });
});
