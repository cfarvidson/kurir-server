/**
 * Integration tests for GET /api/push/vapid-public-key
 *
 * Covers:
 * - 200 with { publicKey } when VAPID is configured (runtime value)
 * - 503 with no publicKey leaked when VAPID is not configured
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config", () => ({
  getConfig: vi.fn(),
}));

describe("GET /api/push/vapid-public-key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with the runtime public key when VAPID is configured", async () => {
    const { getConfig } = await import("@/lib/config");
    vi.mocked(getConfig).mockReturnValue({
      vapid: {
        publicKey: "RUNTIME_PUBLIC_KEY",
        privateKey: "RUNTIME_PRIVATE_KEY",
        configured: true,
      },
    } as never);

    const { GET } = await import("@/app/api/push/vapid-public-key/route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.publicKey).toBe("RUNTIME_PUBLIC_KEY");
  });

  it("returns 503 and does not leak a publicKey when VAPID is unconfigured", async () => {
    const { getConfig } = await import("@/lib/config");
    vi.mocked(getConfig).mockReturnValue({
      vapid: {
        publicKey: undefined,
        privateKey: undefined,
        configured: false,
      },
    } as never);

    const { GET } = await import("@/app/api/push/vapid-public-key/route");
    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.publicKey).toBeUndefined();
    expect(body.error).toBeTruthy();
  });
});
