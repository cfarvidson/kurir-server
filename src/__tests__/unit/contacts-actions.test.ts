import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    contact: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    contactEmail: {
      findFirst: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
    sender: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

describe("createContact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null);

    const { createContact } = await import("@/actions/contacts");
    await expect(
      createContact({
        name: "Test",
        emails: [{ email: "a@b.com", label: "work" }],
      }),
    ).rejects.toThrow("Unauthorized");
  });

  it("throws when name is empty", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { createContact } = await import("@/actions/contacts");
    await expect(
      createContact({
        name: "  ",
        emails: [{ email: "a@b.com", label: "work" }],
      }),
    ).rejects.toThrow("Name is required");
  });

  it("throws when emails array is empty", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { createContact } = await import("@/actions/contacts");
    await expect(createContact({ name: "Alice", emails: [] })).rejects.toThrow(
      "At least one email is required",
    );
  });

  it("throws when email already linked to another contact", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.contactEmail.findFirst).mockResolvedValue({
      email: "existing@example.com",
    } as any);

    const { createContact } = await import("@/actions/contacts");
    await expect(
      createContact({
        name: "Bob",
        emails: [{ email: "existing@example.com", label: "personal" }],
      }),
    ).rejects.toThrow("already linked");
  });

  it("creates contact with sender auto-linking", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.contactEmail.findFirst).mockResolvedValue(null);
    vi.mocked(db.sender.findMany).mockResolvedValue([
      { id: "sender-1", email: "alice@example.com" },
    ] as any);
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        contact: {
          create: vi.fn().mockResolvedValue({ id: "contact-1" }),
        },
        contactEmail: {
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      return fn(tx);
    });

    const { createContact } = await import("@/actions/contacts");
    const result = await createContact({
      name: "Alice",
      emails: [{ email: "alice@example.com", label: "personal" }],
    });

    expect(result).toBe("contact-1");
  });
});

describe("deleteContact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null);

    const { deleteContact } = await import("@/actions/contacts");
    await expect(deleteContact("contact-1")).rejects.toThrow("Unauthorized");
  });

  it("throws when contact not owned by user", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.contact.findUnique).mockResolvedValue({
      userId: "other-user",
    } as any);

    const { deleteContact } = await import("@/actions/contacts");
    await expect(deleteContact("contact-1")).rejects.toThrow(
      "Contact not found",
    );
  });

  it("deletes contact when owned by user", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as any);

    const { db } = await import("@/lib/db");
    vi.mocked(db.contact.findUnique).mockResolvedValue({
      userId: "user-1",
    } as any);
    vi.mocked(db.contact.delete).mockResolvedValue({} as any);

    const { deleteContact } = await import("@/actions/contacts");
    await deleteContact("contact-1");

    expect(db.contact.delete).toHaveBeenCalledWith({
      where: { id: "contact-1" },
    });
  });
});

describe("findOrCreateContactForEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns existing contact when email already linked", async () => {
    const { db } = await import("@/lib/db");
    const existingContact = {
      id: "contact-1",
      name: "Alice",
      emails: [{ email: "alice@example.com" }],
    };
    vi.mocked(db.contactEmail.findFirst).mockResolvedValue({
      contact: existingContact,
    } as any);

    const { findOrCreateContactForEmail } = await import("@/actions/contacts");
    const result = await findOrCreateContactForEmail(
      "user-1",
      "Alice@Example.com",
      "Alice",
    );

    expect(result).toEqual(existingContact);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("creates new contact when email not linked", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactEmail.findFirst).mockResolvedValue(null);
    vi.mocked(db.sender.findFirst).mockResolvedValue(null);

    const newContact = { id: "contact-2", name: "Bob", emails: [] };
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        contact: {
          create: vi.fn().mockResolvedValue({ id: "contact-2" }),
          findUniqueOrThrow: vi.fn().mockResolvedValue(newContact),
        },
        contactEmail: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    const { findOrCreateContactForEmail } = await import("@/actions/contacts");
    const result = await findOrCreateContactForEmail(
      "user-1",
      "bob@example.com",
      "Bob",
    );

    expect(result).toEqual(newContact);
  });

  it("normalizes email to lowercase", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactEmail.findFirst).mockResolvedValue(null);
    vi.mocked(db.sender.findFirst).mockResolvedValue(null);
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        contact: {
          create: vi.fn().mockResolvedValue({ id: "c1" }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "c1" }),
        },
        contactEmail: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });

    const { findOrCreateContactForEmail } = await import("@/actions/contacts");
    await findOrCreateContactForEmail("user-1", "BOB@Example.COM");

    expect(db.contactEmail.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ email: "bob@example.com" }),
      }),
    );
  });
});
