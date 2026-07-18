/**
 * Integration tests for POST /api/mobile/actions — batch dispatch to the
 * shared mutation cores, per-action error isolation, and auth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mail/mutations", () => ({
  archiveThread: vi.fn(),
  unarchiveThread: vi.fn(),
  setThreadReadState: vi.fn(),
  snoozeThread: vi.fn(),
  unsnoozeThread: vi.fn(),
  approveSenderForUser: vi.fn(),
  rejectSenderForUser: vi.fn(),
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

describe("POST /api/mobile/actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without valid bearer auth", async () => {
    const { requireMobileAuth } = await import("@/lib/mobile/auth");
    vi.mocked(requireMobileAuth).mockResolvedValue(null);

    const { POST } = await import("@/app/api/mobile/actions/route");
    const res = await POST(
      makeRequest({
        actions: [{ id: "1", type: "archive", messageId: "m1" }],
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for an unknown action type", async () => {
    await mockAuthed();

    const { POST } = await import("@/app/api/mobile/actions/route");
    const res = await POST(
      makeRequest({ actions: [{ id: "1", type: "explode" }] }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty batch", async () => {
    await mockAuthed();

    const { POST } = await import("@/app/api/mobile/actions/route");
    const res = await POST(makeRequest({ actions: [] }));
    expect(res.status).toBe(400);
  });

  it("dispatches each action to its mutation core with the authed userId", async () => {
    await mockAuthed();
    const mutations = await import("@/lib/mail/mutations");

    const { POST } = await import("@/app/api/mobile/actions/route");
    const res = await POST(
      makeRequest({
        actions: [
          { id: "1", type: "archive", messageId: "m1" },
          { id: "2", type: "setRead", messageId: "m2", isRead: true },
          {
            id: "3",
            type: "approveSender",
            senderId: "s1",
            category: "FEED",
          },
          {
            id: "4",
            type: "snooze",
            messageId: "m3",
            until: "2027-01-01T09:00:00.000Z",
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    expect(mutations.archiveThread).toHaveBeenCalledWith("user-1", "m1");
    expect(mutations.setThreadReadState).toHaveBeenCalledWith(
      "user-1",
      "m2",
      true,
    );
    expect(mutations.approveSenderForUser).toHaveBeenCalledWith(
      "user-1",
      "s1",
      "FEED",
    );
    expect(mutations.snoozeThread).toHaveBeenCalledWith(
      "user-1",
      "m3",
      new Date("2027-01-01T09:00:00.000Z"),
    );

    const body = await res.json();
    expect(body.results).toEqual([
      { id: "1", ok: true },
      { id: "2", ok: true },
      { id: "3", ok: true },
      { id: "4", ok: true },
    ]);
  });

  it("isolates per-action failures and keeps processing the batch", async () => {
    await mockAuthed();
    const mutations = await import("@/lib/mail/mutations");
    vi.mocked(mutations.archiveThread).mockRejectedValue(
      new Error("Message not found"),
    );

    const { POST } = await import("@/app/api/mobile/actions/route");
    const res = await POST(
      makeRequest({
        actions: [
          { id: "1", type: "archive", messageId: "gone" },
          { id: "2", type: "setRead", messageId: "m2", isRead: false },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0]).toEqual({
      id: "1",
      ok: false,
      error: "Message not found",
    });
    expect(body.results[1]).toEqual({ id: "2", ok: true });
    expect(mutations.setThreadReadState).toHaveBeenCalled();
  });

  it("rejects batches larger than 50", async () => {
    await mockAuthed();

    const actions = Array.from({ length: 51 }, (_, i) => ({
      id: String(i),
      type: "archive",
      messageId: `m${i}`,
    }));

    const { POST } = await import("@/app/api/mobile/actions/route");
    const res = await POST(makeRequest({ actions }));
    expect(res.status).toBe(400);
  });
});
