import { describe, it, expect } from "vitest";
import {
  resolveRecipientName,
  type RecipientNameMap,
} from "@/lib/mail/recipient-names";

const map: RecipientNameMap = {
  "alice@example.com": "Alice",
  "carol@x.com": "Carol",
};

describe("resolveRecipientName", () => {
  it("returns the contact name when the address resolves (R10, AE4)", () => {
    expect(resolveRecipientName("alice@example.com", map)).toBe("Alice");
  });

  it("falls back to the raw address when unknown (R11, AE4)", () => {
    expect(resolveRecipientName("bob@example.com", map)).toBe(
      "bob@example.com",
    );
  });

  it("matches case-insensitively", () => {
    expect(resolveRecipientName("Carol@X.com", map)).toBe("Carol");
  });

  it("returns the raw address with an empty map (R11)", () => {
    expect(resolveRecipientName("x@y.com", {})).toBe("x@y.com");
  });

  it("falls back when the mapped name is blank", () => {
    expect(resolveRecipientName("a@b.com", { "a@b.com": "  " })).toBe(
      "a@b.com",
    );
  });
});
