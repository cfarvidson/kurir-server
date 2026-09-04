import { describe, it, expect, vi, afterEach } from "vitest";
import { checkImageExists, parseGhcrRef } from "../image-availability";

const REF = "ghcr.io/cfarvidson/kurir-server:v2026.66";

function stubRegistry(
  manifestStatus: number,
  tokenBody: unknown = { token: "t" },
) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://ghcr.io/token")) {
        return { ok: true, status: 200, json: async () => tokenBody };
      }
      if (url.startsWith("https://ghcr.io/v2/")) {
        expect(init?.method).toBe("HEAD");
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer t",
        );
        return { ok: manifestStatus === 200, status: manifestStatus };
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseGhcrRef", () => {
  it("splits a ghcr tag reference", () => {
    expect(parseGhcrRef(REF)).toEqual({
      name: "cfarvidson/kurir-server",
      tag: "v2026.66",
    });
  });

  it("rejects other registries and digest references", () => {
    expect(parseGhcrRef("docker.io/library/postgres:16")).toBeNull();
    expect(
      parseGhcrRef("ghcr.io/cfarvidson/kurir-server@sha256:abc"),
    ).toBeNull();
    expect(parseGhcrRef("ghcr.io/cfarvidson/kurir-server")).toBeNull();
  });
});

describe("checkImageExists", () => {
  it("is true when the manifest HEAD returns 200", async () => {
    const fetchMock = stubRegistry(200);
    await expect(checkImageExists(REF)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ghcr.io/token?scope=repository:cfarvidson/kurir-server:pull",
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ghcr.io/v2/cfarvidson/kurir-server/manifests/v2026.66",
      expect.anything(),
    );
  });

  it("is false when the tag is not published yet (404)", async () => {
    stubRegistry(404);
    await expect(checkImageExists(REF)).resolves.toBe(false);
  });

  it("throws on any other registry status so callers keep their previous answer", async () => {
    stubRegistry(500);
    await expect(checkImageExists(REF)).rejects.toThrow(/500/);
  });

  it("throws when the token endpoint gives no token", async () => {
    stubRegistry(200, {});
    await expect(checkImageExists(REF)).rejects.toThrow(/no token/);
  });

  it("passes a timeout signal to both requests and surfaces a timeout as a throw", async () => {
    const fetchMock = stubRegistry(200);
    await checkImageExists(REF);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted", "TimeoutError");
      }),
    );
    await expect(checkImageExists(REF)).rejects.toThrow(/aborted/);
  });

  it("throws on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );
    await expect(checkImageExists(REF)).rejects.toThrow(/ECONNRESET/);
  });

  it("skips the probe for non-ghcr references", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      checkImageExists("registry.example.com/kurir:v2026.66"),
    ).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
