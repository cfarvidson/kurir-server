import { describe, it, expect, vi } from "vitest";
import { isOwnAddress, type OwnAddresses } from "../user-emails";

vi.mock("@/lib/db", () => ({ db: {} }));

describe("isOwnAddress", () => {
  it("matches an exact address regardless of case", () => {
    const own: OwnAddresses = {
      emails: ["foo@bar.se"],
      domains: [],
    };
    expect(isOwnAddress("foo@bar.se", own)).toBe(true);
    expect(isOwnAddress("Foo@Bar.SE", own)).toBe(true);
    expect(isOwnAddress("  foo@bar.se  ", own)).toBe(true);
  });

  it("matches any address on a wildcard domain", () => {
    const own: OwnAddresses = {
      emails: [],
      domains: ["example.com"],
    };
    expect(isOwnAddress("user@example.com", own)).toBe(true);
    expect(isOwnAddress("test@example.com", own)).toBe(true);
    expect(isOwnAddress("User@Example.Com", own)).toBe(true);
  });

  it("does NOT match an address on a non-listed domain", () => {
    const own: OwnAddresses = {
      emails: ["foo@bar.se"],
      domains: ["listed.com"],
    };
    expect(isOwnAddress("user@unlisted.com", own)).toBe(false);
    expect(isOwnAddress("test@other.com", own)).toBe(false);
  });

  it("handles an input without @ (no crash, no match)", () => {
    const own: OwnAddresses = {
      emails: ["foo@bar.se"],
      domains: ["example.com"],
    };
    expect(isOwnAddress("nodomain", own)).toBe(false);
    expect(isOwnAddress("just-text", own)).toBe(false);
  });
});
