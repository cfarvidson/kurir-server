import { describe, it, expect, vi } from "vitest";

// `mobile.ts` pulls in `@/lib/mobile/auth` (next-auth) and `@/lib/calendar/write`
// (the Prisma client) just to build its route helpers - neither is exercised
// by these pure parser tests, and both fail to resolve outside a Next.js
// runtime, so stub them out before importing.
vi.mock("@/lib/mobile/auth", () => ({ requireMobileAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { parseOccurrence } from "@/lib/calendar/mobile";

describe("parseOccurrence", () => {
  it("parses a valid ISO string", () => {
    const result = parseOccurrence("2026-08-21T09:00:00.000Z");
    expect(result?.toISOString()).toBe("2026-08-21T09:00:00.000Z");
  });

  it("returns null for a malformed string", () => {
    expect(parseOccurrence("not-a-date")).toBeNull();
  });

  it("returns null for nil", () => {
    expect(parseOccurrence(null)).toBeNull();
  });
});
