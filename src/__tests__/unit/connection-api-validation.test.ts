/**
 * Unit tests for the connection API input validation logic.
 * Tests the Zod schemas used by /api/connections and /api/connections/[id].
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirror the schema from /api/connections/route.ts
const createConnectionSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  imapHost: z.string().min(1),
  imapPort: z.coerce.number().int().min(1).max(65535).default(993),
  smtpHost: z.string().min(1),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
  displayName: z.string().optional(),
  isDefault: z.boolean().optional().default(false),
});

// Mirror the schema from /api/connections/[id]/route.ts
const updateConnectionSchema = z.object({
  password: z.string().min(1).optional(),
  imapHost: z.string().min(1).optional(),
  imapPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpHost: z.string().min(1).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  displayName: z.string().optional(),
  isDefault: z.boolean().optional(),
});

describe("createConnectionSchema", () => {
  it("accepts a complete valid connection", () => {
    const result = createConnectionSchema.safeParse({
      email: "user@gmail.com",
      password: "app-password",
      imapHost: "imap.gmail.com",
      imapPort: 993,
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
    });
    expect(result.success).toBe(true);
  });

  it("applies default port values", () => {
    const result = createConnectionSchema.safeParse({
      email: "user@gmail.com",
      password: "pass",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imapPort).toBe(993);
      expect(result.data.smtpPort).toBe(587);
      expect(result.data.isDefault).toBe(false);
    }
  });

  it("coerces string port numbers to integers", () => {
    const result = createConnectionSchema.safeParse({
      email: "user@gmail.com",
      password: "pass",
      imapHost: "imap.example.com",
      imapPort: "993",
      smtpHost: "smtp.example.com",
      smtpPort: "587",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imapPort).toBe(993);
      expect(result.data.smtpPort).toBe(587);
    }
  });

  it("rejects invalid email", () => {
    const result = createConnectionSchema.safeParse({
      email: "not-an-email",
      password: "pass",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty password", () => {
    const result = createConnectionSchema.safeParse({
      email: "user@gmail.com",
      password: "",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects port below 1", () => {
    const result = createConnectionSchema.safeParse({
      email: "user@gmail.com",
      password: "pass",
      imapHost: "imap.gmail.com",
      imapPort: 0,
      smtpHost: "smtp.gmail.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects port above 65535", () => {
    const result = createConnectionSchema.safeParse({
      email: "user@gmail.com",
      password: "pass",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
      smtpPort: 65536,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty imap host", () => {
    const result = createConnectionSchema.safeParse({
      email: "user@gmail.com",
      password: "pass",
      imapHost: "",
      smtpHost: "smtp.gmail.com",
    });
    expect(result.success).toBe(false);
  });

  it("allows optional displayName", () => {
    const result = createConnectionSchema.safeParse({
      email: "user@gmail.com",
      password: "pass",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
      displayName: "Work Account",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe("Work Account");
    }
  });

  it("allows isDefault=true", () => {
    const result = createConnectionSchema.safeParse({
      email: "user@gmail.com",
      password: "pass",
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
      isDefault: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isDefault).toBe(true);
    }
  });
});

describe("updateConnectionSchema", () => {
  it("accepts empty update (no-op patch)", () => {
    const result = updateConnectionSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts partial update with just password", () => {
    const result = updateConnectionSchema.safeParse({ password: "new-password" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.password).toBe("new-password");
    }
  });

  it("accepts isDefault=true to promote a connection", () => {
    const result = updateConnectionSchema.safeParse({ isDefault: true });
    expect(result.success).toBe(true);
  });

  it("rejects empty string password (when provided)", () => {
    const result = updateConnectionSchema.safeParse({ password: "" });
    expect(result.success).toBe(false);
  });

  it("rejects port out of range in update", () => {
    const result = updateConnectionSchema.safeParse({ imapPort: 99999 });
    expect(result.success).toBe(false);
  });

  it("allows updating display name only", () => {
    const result = updateConnectionSchema.safeParse({ displayName: "Personal" });
    expect(result.success).toBe(true);
  });
});
