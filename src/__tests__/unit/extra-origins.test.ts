import { afterEach, describe, expect, it } from "vitest";
import { getConfig, resetConfig } from "@/lib/config";

const ENV_KEYS = [
  "NEXTAUTH_URL",
  "KURIR_DOMAIN",
  "KURIR_EXTRA_ORIGINS",
  "WEBAUTHN_RP_ID",
] as const;

describe("KURIR_EXTRA_ORIGINS", () => {
  const previous = new Map<string, string | undefined>();

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previous.clear();
    resetConfig();
  });

  function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
    if (!previous.has(key)) previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    resetConfig();
  }

  it("accepts the canonical origin and each extra origin", () => {
    setEnv("KURIR_DOMAIN", "mcp.example.com");
    setEnv("NEXTAUTH_URL", "https://mcp.example.com/kurir");
    setEnv(
      "KURIR_EXTRA_ORIGINS",
      "https://mail.example.com, not a url, https://mcp.example.com",
    );
    expect(getConfig().webauthn.origins).toEqual([
      "https://mcp.example.com",
      "https://mail.example.com",
    ]);
    expect(getConfig().webauthn.origin).toBe("https://mcp.example.com/kurir");
  });
});
