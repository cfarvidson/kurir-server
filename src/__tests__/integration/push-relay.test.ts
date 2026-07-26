/**
 * Integration tests for the APNs relay fallback in push-sender:
 * with PUSH_RELAY_URL set and no APNS_* keys, iOS pushes go via the relay
 * and the relay's result shape drives the same pruning as direct APNs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    pushSubscription: {
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    message: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    vapid: { configured: false, publicKey: null, privateKey: null },
    adminEmail: "",
  }),
}));

const TOKEN = "a".repeat(64);
const SUB = {
  id: "sub-1",
  platform: "ios",
  endpoint: `apns:${TOKEN}`,
  p256dh: "",
  auth: "",
};

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

let urlCounter = 0;
// pushToUser dedups on userId+url in module scope — unique URL per test
function payload() {
  urlCounter += 1;
  return {
    title: "New mail",
    body: "From someone",
    url: `https://kurir.example.com/imbox/${urlCounter}`,
  };
}

describe("pushToUser via relay", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.PUSH_RELAY_URL = "https://kurir-notify.example.com";
    delete process.env.APNS_KEY_P8;
    const { db } = await import("@/lib/db");
    vi.mocked(db.pushSubscription.findMany).mockResolvedValue([SUB] as any);
  });

  afterEach(() => {
    delete process.env.PUSH_RELAY_URL;
  });

  it("sends via the relay and keeps the subscription on ok", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, gone: false, status: 200 }),
    });

    const { pushToUser } = await import("@/lib/mail/push-sender");
    await pushToUser("user-1", payload());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://kurir-notify.example.com/api/push");
    const body = JSON.parse(init.body);
    expect(body.deviceToken).toBe(TOKEN);
    expect(body.notification.title).toBe("New mail");

    const { db } = await import("@/lib/db");
    expect(db.pushSubscription.delete).not.toHaveBeenCalled();
  });

  it("prunes the subscription when the relay reports gone", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        gone: true,
        status: 410,
        reason: "BadDeviceToken",
      }),
    });
    const { db } = await import("@/lib/db");
    vi.mocked(db.pushSubscription.delete).mockResolvedValue(SUB as any);

    const { pushToUser } = await import("@/lib/mail/push-sender");
    await pushToUser("user-1", payload());

    expect(db.pushSubscription.delete).toHaveBeenCalledWith({
      where: { id: "sub-1" },
    });
  });

  it("includes the unread Imbox thread count as badge in the relay payload", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, gone: false, status: 200 }),
    });
    const { db } = await import("@/lib/db");
    vi.mocked(db.message.findMany).mockResolvedValue([
      { id: "m1", threadId: "t1", sender: { unthread: false } },
      { id: "m2", threadId: "t1", sender: { unthread: false } },
    ] as any);

    const { pushToUser } = await import("@/lib/mail/push-sender");
    await pushToUser("user-1", payload());

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.notification.badge).toBe(1);
  });

  it("survives network errors without throwing and without pruning", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const { pushToUser } = await import("@/lib/mail/push-sender");
    await expect(pushToUser("user-1", payload())).resolves.toBeUndefined();

    const { db } = await import("@/lib/db");
    expect(db.pushSubscription.delete).not.toHaveBeenCalled();
  });
});
