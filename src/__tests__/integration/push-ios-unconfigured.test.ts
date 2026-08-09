/**
 * With VAPID configured but neither APNS_* keys nor PUSH_RELAY_URL set
 * (the self-host default before PUSH_RELAY_URL existed), pushToUser must
 * skip iOS subscriptions with a clear warning instead of attempting a
 * relay send against "undefined/api/push".
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
    vapid: { configured: true, publicKey: "pub", privateKey: "priv" },
    adminEmail: "",
  }),
}));

vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));

const SUB = {
  id: "sub-1",
  platform: "ios",
  endpoint: `apns:${"a".repeat(64)}`,
  p256dh: "",
  auth: "",
  apnsEnv: null,
};

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("pushToUser with iOS subscription but no APNs config and no relay", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.PUSH_RELAY_URL;
    delete process.env.APNS_KEY_P8;
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_BUNDLE_ID;
    const { db } = await import("@/lib/db");
    vi.mocked(db.pushSubscription.findMany).mockResolvedValue([SUB] as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips the iOS send with a warning instead of fetching undefined/api/push", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { pushToUser } = await import("@/lib/mail/push-sender");
    await pushToUser("user-unconfigured", {
      title: "New mail",
      body: "From someone",
      url: "https://kurir.example.com/imbox/unconfigured-1",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("iOS push not configured"),
    );

    const { db } = await import("@/lib/db");
    expect(db.pushSubscription.delete).not.toHaveBeenCalled();
  });
});
