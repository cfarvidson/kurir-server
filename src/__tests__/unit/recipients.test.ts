import { describe, it, expect } from "vitest";
import { parseRecipients } from "@/lib/mail/recipients";

describe("parseRecipients", () => {
  it("parses a single bare address", () => {
    expect(parseRecipients("a@example.com")).toEqual({
      recipients: ["a@example.com"],
      invalid: [],
    });
  });

  it("splits comma-separated addresses and trims whitespace", () => {
    expect(parseRecipients("a@example.com, b@example.com ,c@example.com")).toEqual(
      {
        recipients: ["a@example.com", "b@example.com", "c@example.com"],
        invalid: [],
      },
    );
  });

  it("splits semicolon-separated addresses", () => {
    expect(parseRecipients("a@example.com; b@example.com")).toEqual({
      recipients: ["a@example.com", "b@example.com"],
      invalid: [],
    });
  });

  it("ignores empty segments from trailing or doubled separators", () => {
    expect(parseRecipients("a@example.com, ,b@example.com,")).toEqual({
      recipients: ["a@example.com", "b@example.com"],
      invalid: [],
    });
  });

  it("dedupes case-insensitively, keeping the first form seen", () => {
    expect(parseRecipients("A@Example.com, a@example.com")).toEqual({
      recipients: ["A@Example.com"],
      invalid: [],
    });
  });

  it("collects malformed addresses in `invalid`", () => {
    const result = parseRecipients("good@example.com, not-an-email, b@x.com");
    expect(result.recipients).toEqual(["good@example.com", "b@x.com"]);
    expect(result.invalid).toEqual(["not-an-email"]);
  });

  it("treats display-name format as invalid (must be a bare address)", () => {
    const result = parseRecipients("Carl <carl@example.com>");
    expect(result.recipients).toEqual([]);
    expect(result.invalid).toEqual(["Carl <carl@example.com>"]);
  });

  it("returns empty arrays for empty or whitespace-only input", () => {
    expect(parseRecipients("")).toEqual({ recipients: [], invalid: [] });
    expect(parseRecipients("   ")).toEqual({ recipients: [], invalid: [] });
  });
});
