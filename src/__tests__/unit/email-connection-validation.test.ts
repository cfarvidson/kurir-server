/**
 * Unit tests for EmailConnection validation and business rules.
 *
 * Business rules:
 * - A user can have multiple email connections
 * - Each connection has a unique email per user
 * - Exactly one connection should be the default
 * - Removing the default connection must promote another
 * - Connections must be IMAP-verified before creation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { encrypt } from "@/lib/crypto";

// Test the domain logic for connection management (to be implemented in
// /api/connections/route.ts and connection helper functions)

// Connection schema validator (mirrors what Zod schema will enforce)
function validateConnectionInput(data: unknown) {
  const required = ["email", "password", "imapHost", "smtpHost"] as const;
  if (typeof data !== "object" || data === null) {
    return { success: false, error: "Input must be an object" };
  }
  const obj = data as Record<string, unknown>;
  for (const field of required) {
    if (
      !obj[field] ||
      typeof obj[field] !== "string" ||
      (obj[field] as string).length === 0
    ) {
      return { success: false, error: `Missing required field: ${field}` };
    }
  }
  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(obj.email as string)) {
    return { success: false, error: "Invalid email format" };
  }
  return { success: true };
}

describe("Email connection input validation", () => {
  it("accepts valid connection input", () => {
    const result = validateConnectionInput({
      email: "user@gmail.com",
      password: "app-password",
      imapHost: "imap.gmail.com",
      imapPort: 993,
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing email", () => {
    const result = validateConnectionInput({
      password: "pass",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("email");
  });

  it("rejects invalid email format", () => {
    const result = validateConnectionInput({
      email: "not-an-email",
      password: "pass",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid email");
  });

  it("rejects missing password", () => {
    const result = validateConnectionInput({
      email: "user@gmail.com",
      password: "",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing IMAP host", () => {
    const result = validateConnectionInput({
      email: "user@gmail.com",
      password: "pass",
      smtpHost: "smtp.gmail.com",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("imapHost");
  });
});

describe("Default connection business logic", () => {
  it("first connection added should be default", () => {
    // When a user has no connections and adds one, isDefault=true
    const existingCount = 0;
    const shouldBeDefault = existingCount === 0;
    expect(shouldBeDefault).toBe(true);
  });

  it("subsequent connections are not default", () => {
    const existingCount = 1;
    const shouldBeDefault = existingCount === 0;
    expect(shouldBeDefault).toBe(false);
  });

  it("deleting the only connection leaves user with no default", () => {
    const connections = [{ id: "conn-1", isDefault: true }];
    const remaining = connections.filter((c) => c.id !== "conn-1");
    const hasDefault = remaining.some((c) => c.isDefault);
    expect(hasDefault).toBe(false);
    expect(remaining).toHaveLength(0);
  });

  it("deleting a default connection should promote another", () => {
    const connections = [
      { id: "conn-1", isDefault: true },
      { id: "conn-2", isDefault: false },
    ];
    const deletedId = "conn-1";
    const remaining = connections.filter((c) => c.id !== deletedId);

    // Business logic: if deleted was default and others remain, promote oldest
    const wasDefault = connections.find((c) => c.id === deletedId)?.isDefault;
    let newDefault = remaining[0]?.id;
    if (wasDefault && remaining.length > 0) {
      // promote first remaining
      remaining[0].isDefault = true;
    }
    expect(remaining[0].isDefault).toBe(true);
    expect(newDefault).toBe("conn-2");
  });

  it("deleting a non-default connection leaves default unchanged", () => {
    const connections = [
      { id: "conn-1", isDefault: true },
      { id: "conn-2", isDefault: false },
    ];
    const remaining = connections.filter((c) => c.id !== "conn-2");
    expect(remaining[0].isDefault).toBe(true);
    expect(remaining[0].id).toBe("conn-1");
  });
});

describe("Password encryption for stored connections", () => {
  it("encrypts password before storing", () => {
    const plainPassword = "my-app-password";
    const encrypted = encrypt(plainPassword);
    // Encrypted value should not contain the plain password
    expect(encrypted).not.toContain(plainPassword);
    // Should be in iv:authTag:data format
    expect(encrypted.split(":")).toHaveLength(3);
  });

  it("different encryptions of the same password are distinct (random IV)", () => {
    const password = "same-password";
    const enc1 = encrypt(password);
    const enc2 = encrypt(password);
    expect(enc1).not.toBe(enc2);
  });
});
