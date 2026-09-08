import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const TOKEN = "b".repeat(64);

describe("sendRelayBackground", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubEnv("PUSH_RELAY_URL", "https://relay.example");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, gone: false, status: 200 }),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts a background push with the read ids", async () => {
    const { sendRelayBackground } = await import("@/lib/push/relay");
    const result = await sendRelayBackground(
      TOKEN,
      { readIds: ["m1", "m2"] },
      { sandbox: true },
    );

    expect(result).toEqual({ ok: true, gone: false, status: 200 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://relay.example/api/push");
    expect(JSON.parse(init.body)).toEqual({
      deviceToken: TOKEN,
      sandbox: true,
      pushType: "background",
      readIds: ["m1", "m2"],
    });
  });

  it("omits readIds when there are none", async () => {
    const { sendRelayBackground } = await import("@/lib/push/relay");
    await sendRelayBackground(TOKEN, {}, { sandbox: false });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      deviceToken: TOKEN,
      sandbox: false,
      pushType: "background",
    });
  });
});
