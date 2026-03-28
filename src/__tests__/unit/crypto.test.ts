import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";

describe("crypto", () => {
  describe("encrypt / decrypt roundtrip", () => {
    it("decrypts what was encrypted", () => {
      const plain = "my-secret-password";
      const ciphertext = encrypt(plain);
      expect(decrypt(ciphertext)).toBe(plain);
    });

    it("produces different ciphertexts for the same input (random IV)", () => {
      const plain = "same-password";
      expect(encrypt(plain)).not.toBe(encrypt(plain));
    });

    it("ciphertext format is iv:authTag:data (three colon-separated parts)", () => {
      const ciphertext = encrypt("test");
      const parts = ciphertext.split(":");
      expect(parts).toHaveLength(3);
      // Each part should be a non-empty base64 string
      for (const part of parts) {
        expect(part.length).toBeGreaterThan(0);
        expect(part).toMatch(/^[A-Za-z0-9+/]+=*$/);
      }
    });

    it("throws on corrupted ciphertext (wrong format)", () => {
      expect(() => decrypt("not-valid")).toThrow(
        "Invalid encrypted text format",
      );
    });

    it("throws on tampered auth tag (integrity check)", () => {
      const ciphertext = encrypt("original");
      const parts = ciphertext.split(":");
      // Replace the auth tag with garbage
      parts[1] = "AAAAAAAAAAAAAAAAAAAAAA==";
      expect(() => decrypt(parts.join(":"))).toThrow();
    });

    it("handles empty string", () => {
      const plain = "";
      expect(decrypt(encrypt(plain))).toBe(plain);
    });

    it("handles unicode content", () => {
      const plain = "pässwörd-with-ünïcödé-🔑";
      expect(decrypt(encrypt(plain))).toBe(plain);
    });

    it("handles long passwords", () => {
      const plain = "a".repeat(10000);
      expect(decrypt(encrypt(plain))).toBe(plain);
    });
  });

  describe("error cases", () => {
    it("throws when ENCRYPTION_KEY is missing", async () => {
      const { resetConfig } = await import("@/lib/config");
      const original = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      resetConfig(); // clear cached config so missing key is detected
      try {
        expect(() => encrypt("test")).toThrow(
          "ENCRYPTION_KEY environment variable is not set",
        );
      } finally {
        process.env.ENCRYPTION_KEY = original;
        resetConfig(); // restore cached config
      }
    });
  });
});
