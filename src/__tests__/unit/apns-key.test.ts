import { describe, it, expect } from "vitest";
import { normalizeP8Key } from "@/lib/push/apns";

const PEM_LINES = [
  "-----BEGIN PRIVATE KEY-----",
  "MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEH",
  "-----END PRIVATE KEY-----",
];
const PEM = PEM_LINES.join("\n");

describe("normalizeP8Key", () => {
  it("converts single-escaped \\n sequences to newlines", () => {
    expect(normalizeP8Key(PEM_LINES.join("\\n"))).toBe(PEM);
  });

  it("converts double-escaped \\\\n sequences to newlines (Kamal env-file escaping)", () => {
    expect(normalizeP8Key(PEM_LINES.join("\\\\n"))).toBe(PEM);
  });

  it("leaves a key with real newlines unchanged", () => {
    expect(normalizeP8Key(PEM)).toBe(PEM);
  });
});
