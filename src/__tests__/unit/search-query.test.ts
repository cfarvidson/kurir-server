import { describe, it, expect } from "vitest";
import { buildPrefixQuery } from "@/lib/mail/search";

describe("buildPrefixQuery", () => {
  it("converts words to prefix tsquery terms joined by &", () => {
    expect(buildPrefixQuery("hello world")).toBe("hello:* & world:*");
  });

  it("handles a single word", () => {
    expect(buildPrefixQuery("test")).toBe("test:*");
  });

  it("returns empty string for empty input", () => {
    expect(buildPrefixQuery("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(buildPrefixQuery("   ")).toBe("");
  });

  it("strips special characters", () => {
    expect(buildPrefixQuery("hello@world.com")).toBe(
      "hello:* & world:* & com:*",
    );
  });

  it("preserves unicode letters", () => {
    const result = buildPrefixQuery("cafe");
    expect(result).toBe("cafe:*");
  });

  it("collapses multiple spaces", () => {
    expect(buildPrefixQuery("hello    world")).toBe("hello:* & world:*");
  });

  it("truncates to 20 words maximum", () => {
    const words = Array.from({ length: 25 }, (_, i) => `word${i}`).join(" ");
    const result = buildPrefixQuery(words);
    const terms = result.split(" & ");
    expect(terms).toHaveLength(20);
  });

  it("strips parentheses and brackets", () => {
    expect(buildPrefixQuery("hello (world) [test]")).toBe(
      "hello:* & world:* & test:*",
    );
  });

  it("strips quotes", () => {
    expect(buildPrefixQuery('"exact phrase"')).toBe("exact:* & phrase:*");
  });
});
