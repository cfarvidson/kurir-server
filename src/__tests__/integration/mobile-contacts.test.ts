/**
 * Integration tests for /api/mobile/contacts — the mobile surface over the
 * shared contact cores. Auth, the label enum, the CRUD round trip and
 * foreign-ownership 404s. The db is mocked so the cores' real ownership and
 * duplicate-guard logic runs against controllable data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  const db = {
    contact: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    contactEmail: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    sender: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { db };
});

vi.mock("@/lib/mobile/auth", () => ({ requireMobileAuth: vi.fn() }));

// The real cache functions THROW outside a Server Action (i.e. in these
// route handlers) — mirror that here so any shared core reached from the
// mobile routes that touches the cache layer fails the suite (the scheduled
// cores regression from 2026-07-26).
vi.mock("next/cache", () => ({
  updateTag: vi.fn(() => {
    throw new Error(
      "updateTag can only be called from within a Server Action",
    );
  }),
  revalidatePath: vi.fn(() => {
    throw new Error(
      "revalidatePath can only be called from within a Server Action",
    );
  }),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitUser: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 }),
  };
});

function makeRequest(body?: unknown) {
  return {
    headers: { get: () => null },
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as any;
}

const params = <T extends Record<string, string>>(p: T) => ({
  params: Promise.resolve(p),
});

const USER = "user-1";

const contactRow = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "Ada Lovelace",
  notes: null,
  userId: USER,
  createdAt: new Date(),
  updatedAt: new Date(),
  emails: [
    {
      id: "e1",
      email: "ada@example.com",
      label: "personal",
      isPrimary: true,
      contactId: "c1",
      senderId: null,
      createdAt: new Date(),
    },
  ],
  ...over,
});

async function listRoute() {
  return import("@/app/api/mobile/contacts/route");
}
async function detailRoute() {
  return import("@/app/api/mobile/contacts/[id]/route");
}
async function emailsRoute() {
  return import("@/app/api/mobile/contacts/[id]/emails/route");
}
async function emailRoute() {
  return import("@/app/api/mobile/contacts/[id]/emails/[emailId]/route");
}

describe("mobile contacts routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { requireMobileAuth } = await import("@/lib/mobile/auth");
    vi.mocked(requireMobileAuth).mockResolvedValue({ userId: USER });

    const { db } = await import("@/lib/db");
    vi.mocked(db.$transaction).mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(db),
    );
  });

  it("(a) all routes return 401 without a bearer token", async () => {
    const { requireMobileAuth } = await import("@/lib/mobile/auth");
    vi.mocked(requireMobileAuth).mockResolvedValue(null);

    const list = await listRoute();
    expect((await list.GET(makeRequest())).status).toBe(401);
    expect((await list.POST(makeRequest({}))).status).toBe(401);

    const detail = await detailRoute();
    expect(
      (await detail.GET(makeRequest(), params({ id: "c1" }))).status,
    ).toBe(401);
    expect(
      (await detail.PATCH(makeRequest({ name: "X" }), params({ id: "c1" })))
        .status,
    ).toBe(401);
    expect(
      (await detail.DELETE(makeRequest(), params({ id: "c1" }))).status,
    ).toBe(401);

    const emails = await emailsRoute();
    expect(
      (
        await emails.POST(
          makeRequest({ email: "x@y.se" }),
          params({ id: "c1" }),
        )
      ).status,
    ).toBe(401);

    const email = await emailRoute();
    expect(
      (
        await email.PATCH(
          makeRequest({ isPrimary: true }),
          params({ id: "c1", emailId: "e1" }),
        )
      ).status,
    ).toBe(401);
    expect(
      (await email.DELETE(makeRequest(), params({ id: "c1", emailId: "e1" })))
        .status,
    ).toBe(401);
  });

  it("(b) CRUD round trip: create → rename → add email → set primary → remove email → delete", async () => {
    const { db } = await import("@/lib/db");

    // -- create --------------------------------------------------------
    vi.mocked(db.contactEmail.findFirst).mockResolvedValue(null); // no dup
    vi.mocked(db.sender.findMany).mockResolvedValue([]);
    vi.mocked(db.contact.create).mockResolvedValue(contactRow() as any);
    vi.mocked(db.contactEmail.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(db.contact.findFirst).mockResolvedValue(contactRow() as any);

    const list = await listRoute();
    const createRes = await list.POST(
      makeRequest({
        name: "Ada Lovelace",
        emails: [{ email: "Ada@Example.com", label: "personal" }],
      }),
    );
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    expect(created.contact).toEqual({
      id: "c1",
      name: "Ada Lovelace",
      emails: [
        {
          id: "e1",
          email: "ada@example.com",
          label: "personal",
          isPrimary: true,
        },
      ],
    });
    // Email normalized to lowercase, first one primary
    expect(db.contactEmail.createMany).toHaveBeenCalledWith({
      data: [
        {
          email: "ada@example.com",
          label: "personal",
          isPrimary: true,
          contactId: "c1",
          senderId: null,
        },
      ],
    });

    // -- rename --------------------------------------------------------
    vi.mocked(db.contact.findUnique).mockResolvedValue({
      userId: USER,
    } as any);
    vi.mocked(db.contact.findFirst).mockResolvedValue(
      contactRow({ name: "Ada K" }) as any,
    );

    const detail = await detailRoute();
    const renameRes = await detail.PATCH(
      makeRequest({ name: "Ada K" }),
      params({ id: "c1" }),
    );
    expect(renameRes.status).toBe(200);
    expect(db.contact.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { name: "Ada K" },
    });

    // -- add email -----------------------------------------------------
    vi.mocked(db.contactEmail.findFirst).mockResolvedValue(null);
    vi.mocked(db.contactEmail.count).mockResolvedValue(1);
    vi.mocked(db.sender.findFirst).mockResolvedValue(null);

    const emails = await emailsRoute();
    const addRes = await emails.POST(
      makeRequest({ email: "ada@work.example", label: "work" }),
      params({ id: "c1" }),
    );
    expect(addRes.status).toBe(200);
    // Not the first email — must not steal primary
    expect(db.contactEmail.create).toHaveBeenCalledWith({
      data: {
        email: "ada@work.example",
        label: "work",
        isPrimary: false,
        contactId: "c1",
        senderId: null,
      },
    });

    // -- set primary ---------------------------------------------------
    vi.mocked(db.contactEmail.findUnique).mockResolvedValue({
      id: "e2",
      isPrimary: false,
      contactId: "c1",
      contact: { userId: USER, id: "c1" },
    } as any);

    const email = await emailRoute();
    const primaryRes = await email.PATCH(
      makeRequest({ isPrimary: true }),
      params({ id: "c1", emailId: "e2" }),
    );
    expect(primaryRes.status).toBe(200);
    expect(db.contactEmail.updateMany).toHaveBeenCalledWith({
      where: { contactId: "c1", isPrimary: true },
      data: { isPrimary: false },
    });
    expect(db.contactEmail.update).toHaveBeenCalledWith({
      where: { id: "e2" },
      data: { isPrimary: true },
    });

    // -- remove email (was primary → promote first remaining) ----------
    vi.mocked(db.contactEmail.findUnique).mockResolvedValue({
      id: "e2",
      isPrimary: true,
      contactId: "c1",
      contact: { userId: USER, id: "c1" },
    } as any);
    vi.mocked(db.contactEmail.findFirst).mockResolvedValue({
      id: "e1",
    } as any);

    const removeRes = await email.DELETE(
      makeRequest(),
      params({ id: "c1", emailId: "e2" }),
    );
    expect(removeRes.status).toBe(200);
    expect(db.contactEmail.delete).toHaveBeenCalledWith({
      where: { id: "e2" },
    });
    expect(db.contactEmail.update).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: { isPrimary: true },
    });

    // -- delete contact ------------------------------------------------
    const deleteRes = await detail.DELETE(makeRequest(), params({ id: "c1" }));
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ success: true });
    expect(db.contact.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("(c) another user's contactId is a 404", async () => {
    const { db } = await import("@/lib/db");

    // Detail GET: scoped findFirst misses entirely
    vi.mocked(db.contact.findFirst).mockResolvedValue(null);
    const detail = await detailRoute();
    const getRes = await detail.GET(makeRequest(), params({ id: "foreign" }));
    expect(getRes.status).toBe(404);

    // Mutations: ownership check inside the core rejects
    vi.mocked(db.contact.findUnique).mockResolvedValue({
      userId: "someone-else",
    } as any);
    const renameRes = await detail.PATCH(
      makeRequest({ name: "X" }),
      params({ id: "foreign" }),
    );
    expect(renameRes.status).toBe(404);
    expect(db.contact.update).not.toHaveBeenCalled();

    const deleteRes = await detail.DELETE(
      makeRequest(),
      params({ id: "foreign" }),
    );
    expect(deleteRes.status).toBe(404);
    expect(db.contact.delete).not.toHaveBeenCalled();

    // Foreign contactEmailId on the per-email route
    vi.mocked(db.contactEmail.findUnique).mockResolvedValue({
      id: "e9",
      isPrimary: false,
      contactId: "cx",
      contact: { userId: "someone-else", id: "cx" },
    } as any);
    const email = await emailRoute();
    const emailRes = await email.DELETE(
      makeRequest(),
      params({ id: "cx", emailId: "e9" }),
    );
    expect(emailRes.status).toBe(404);
    expect(db.contactEmail.delete).not.toHaveBeenCalled();
  });

  it("(d) an invalid label is a 400 before any db work", async () => {
    const { db } = await import("@/lib/db");

    const list = await listRoute();
    const createRes = await list.POST(
      makeRequest({
        name: "Ada",
        emails: [{ email: "ada@example.com", label: "banana" }],
      }),
    );
    expect(createRes.status).toBe(400);

    const emails = await emailsRoute();
    const addRes = await emails.POST(
      makeRequest({ email: "a@b.se", label: "banana" }),
      params({ id: "c1" }),
    );
    expect(addRes.status).toBe(400);

    const email = await emailRoute();
    const patchRes = await email.PATCH(
      makeRequest({ label: "banana" }),
      params({ id: "c1", emailId: "e1" }),
    );
    expect(patchRes.status).toBe(400);

    expect(db.contactEmail.create).not.toHaveBeenCalled();
    expect(db.contactEmail.update).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("a duplicate email on create is a 400 with the web action's message", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactEmail.findFirst).mockResolvedValue({
      email: "ada@example.com",
    } as any);

    const list = await listRoute();
    const res = await list.POST(
      makeRequest({
        name: "Ada",
        emails: [{ email: "ada@example.com" }],
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "Email ada@example.com is already linked to a contact",
    );
  });
});
