import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    pushSubscription: {
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const sendApnsBackground = vi.fn();
const sendRelayBackground = vi.fn();
vi.mock("@/lib/push/apns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/push/apns")>();
  return {
    ...actual,
    apnsConfigured: vi.fn(() => true),
    sendApnsBackground: (...args: unknown[]) => sendApnsBackground(...args),
  };
});
vi.mock("@/lib/push/relay", () => ({
  relayConfigured: vi.fn(() => false),
  sendRelayNotification: vi.fn(),
  sendRelayBackground: (...args: unknown[]) => sendRelayBackground(...args),
}));

const TOKEN = "a".repeat(64);
const SUB = {
  id: "sub-1",
  endpoint: `apns:${TOKEN}`,
  apnsEnv: "sandbox" as const,
};

describe("nudgeIosClients", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sendApnsBackground.mockResolvedValue({ ok: true, gone: false, status: 200 });
    const { db } = await import("@/lib/db");
    vi.mocked(db.pushSubscription.findMany).mockResolvedValue([SUB] as never);
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });

  it("sends one background push carrying the read ids of a burst", async () => {
    const { nudgeIosClients } = await import("@/lib/mail/push-sender");
    nudgeIosClients("user-1", ["m1"]);
    nudgeIosClients("user-1", ["m2", "m1"]);
    nudgeIosClients("user-1", ["m3"]);
    expect(sendApnsBackground).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(sendApnsBackground).toHaveBeenCalledTimes(1);
    expect(sendApnsBackground).toHaveBeenCalledWith(
      TOKEN,
      { readIds: ["m2", "m1", "m3"] },
      { sandbox: true },
    );
  });

  it("keeps the newest ids when a burst exceeds the payload cap", async () => {
    const { nudgeIosClients } = await import("@/lib/mail/push-sender");
    const ids = Array.from({ length: 120 }, (_, i) => `m${i}`);
    nudgeIosClients("user-1", ids);
    await vi.advanceTimersByTimeAsync(500);

    const sent = sendApnsBackground.mock.calls[0][1] as { readIds: string[] };
    expect(sent.readIds).toHaveLength(100);
    expect(sent.readIds[0]).toBe("m20");
    expect(sent.readIds[99]).toBe("m119");
  });

  it("does not send when the user has no iOS tokens", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.pushSubscription.findMany).mockResolvedValue([]);
    const { nudgeIosClients } = await import("@/lib/mail/push-sender");
    nudgeIosClients("user-1", ["m1"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(sendApnsBackground).not.toHaveBeenCalled();
  });
});


