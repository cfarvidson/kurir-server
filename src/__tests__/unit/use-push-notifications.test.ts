// @vitest-environment jsdom
/**
 * Unit tests for usePushNotifications.
 *
 * Covers:
 * - subscribe() fetches the VAPID public key at runtime, then subscribes with it
 * - subscribe() throws a clear error and does NOT subscribe when the key
 *   endpoint is unavailable (503) or returns an empty key
 * - base64UrlToUint8Array decodes to the correct byte length
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  usePushNotifications,
  base64UrlToUint8Array,
} from "@/hooks/use-push-notifications";

const pushSubscribe = vi.fn();
const swReg = {
  pushManager: {
    subscribe: pushSubscribe,
    getSubscription: vi.fn().mockResolvedValue(null),
  },
};

function stubServiceWorker() {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: vi.fn().mockResolvedValue(swReg),
      ready: Promise.resolve(swReg),
    },
  });
  // jsdom lacks PushManager / Notification
  (window as unknown as { PushManager: unknown }).PushManager = function () {};
  (window as unknown as { Notification: unknown }).Notification = {
    permission: "granted",
  };
}

function makeSubscription() {
  return {
    toJSON: () => ({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "p".repeat(80), auth: "a".repeat(20) },
    }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

describe("usePushNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubServiceWorker();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the VAPID public key at runtime and subscribes with it", async () => {
    const validKey = "BHello-World_abc123"; // base64url, decodes cleanly
    const fetchMock = vi
      .fn()
      // useEffect probe + subscribe() both hit the key endpoint
      .mockResolvedValue({ ok: true, json: async () => ({ publicKey: validKey }) });
    vi.stubGlobal("fetch", fetchMock);
    pushSubscribe.mockResolvedValue(makeSubscription());

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.subscribe();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/push/vapid-public-key");
    expect(pushSubscribe).toHaveBeenCalledTimes(1);
    const arg = pushSubscribe.mock.calls[0][0];
    expect(arg.userVisibleOnly).toBe(true);
    expect(arg.applicationServerKey).toBeInstanceOf(Uint8Array);
  });

  it("throws and does not subscribe when the key endpoint is unavailable", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/push/vapid-public-key") {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePushNotifications());

    await expect(result.current.subscribe()).rejects.toThrow(/not configured/i);
    expect(pushSubscribe).not.toHaveBeenCalled();
  });

  it("throws when the key endpoint returns an empty key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ publicKey: "" }) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePushNotifications());

    await expect(result.current.subscribe()).rejects.toThrow(/not configured/i);
    expect(pushSubscribe).not.toHaveBeenCalled();
  });

  it("rolls back (unsubscribes) and throws when saving the subscription fails", async () => {
    const validKey = "BHello-World_abc123";
    const sub = makeSubscription();
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/push/vapid-public-key") {
        return { ok: true, json: async () => ({ publicKey: validKey }) };
      }
      // POST /api/push/subscribe fails to persist
      return { ok: false, status: 500, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    pushSubscribe.mockResolvedValue(sub);

    const { result } = renderHook(() => usePushNotifications());

    await expect(result.current.subscribe()).rejects.toThrow(/save/i);
    expect(pushSubscribe).toHaveBeenCalledTimes(1);
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("usePushNotifications: isConfigured probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubServiceWorker();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets isConfigured=false when the probe returns a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );

    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => expect(result.current.isConfigured).toBe(false));
  });

  it("leaves isConfigured null (unknown) on a transient probe network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const { result } = renderHook(() => usePushNotifications());

    // Give the probe a chance to reject; it must not flip to false.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.isConfigured).toBeNull();
  });
});

describe("base64UrlToUint8Array", () => {
  it("decodes a base64url string to the correct byte length", () => {
    // "BHello" -> base64url; verify it round-trips to bytes without throwing
    const bytes = base64UrlToUint8Array("SGVsbG8") as Uint8Array; // "Hello"
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(5);
    expect(String.fromCharCode(...bytes)).toBe("Hello");
  });
});
