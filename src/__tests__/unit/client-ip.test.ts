import { describe, it, expect } from "vitest";
import { getClientIp } from "@/lib/client-ip";

function headers(map: Record<string, string>) {
  return {
    get(name: string) {
      return map[name.toLowerCase()] ?? null;
    },
  };
}

describe("getClientIp", () => {
  it("prefers X-Real-IP over X-Forwarded-For", () => {
    expect(
      getClientIp(
        headers({
          "x-real-ip": "10.1.2.3",
          "x-forwarded-for": "1.1.1.1, 10.1.2.3",
        }),
      ),
    ).toBe("10.1.2.3");
  });

  it("uses the rightmost X-Forwarded-For hop, not the leftmost", () => {
    expect(
      getClientIp(headers({ "x-forwarded-for": "8.8.8.8, 203.0.113.10" })),
    ).toBe("203.0.113.10");
  });

  it("returns unknown when no forwarding headers are present", () => {
    expect(getClientIp(headers({}))).toBe("unknown");
  });
});
