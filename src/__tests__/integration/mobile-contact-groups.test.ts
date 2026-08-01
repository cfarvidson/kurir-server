/**
 * Integration tests for /api/mobile/contact-groups — the mobile surface over
 * the shared contact-group cores. Auth, the target enum, the CRUD + member
 * round trip and foreign-ownership 404s. The db is mocked so the cores' real
 * ownership and duplicate-guard logic runs against controllable data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  const db = {
    contactGroup: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    contactGroupMember: {
      findUnique: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      delete: vi.fn(),
    },
    contactEmail: {
      findMany: vi.fn(),
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

const groupRow = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  name: "Family",
  defaultTarget: "TO",
  members: [
    {
      id: "m1",
      contactEmailId: "ce1",
      contactEmail: {
        id: "ce1",
        email: "ada@example.com",
        contact: { id: "c1", name: "Ada Lovelace" },
      },
    },
  ],
  ...over,
});

async function listRoute() {
  return import("@/app/api/mobile/contact-groups/route");
}
async function detailRoute() {
  return import("@/app/api/mobile/contact-groups/[id]/route");
}
async function membersRoute() {
  return import("@/app/api/mobile/contact-groups/[id]/members/route");
}
async function memberRoute() {
  return import("@/app/api/mobile/contact-groups/[id]/members/[memberId]/route");
}

describe("mobile contact-groups routes", () => {
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
      (await detail.PATCH(makeRequest({ name: "X" }), params({ id: "g1" })))
        .status,
    ).toBe(401);
    expect(
      (await detail.DELETE(makeRequest(), params({ id: "g1" }))).status,
    ).toBe(401);

    const members = await membersRoute();
    expect(
      (
        await members.POST(
          makeRequest({ contactEmailId: "ce1" }),
          params({ id: "g1" }),
        )
      ).status,
    ).toBe(401);

    const member = await memberRoute();
    expect(
      (
        await member.DELETE(
          makeRequest(),
          params({ id: "g1", memberId: "m1" }),
        )
      ).status,
    ).toBe(401);
  });

  it("(b) CRUD round trip: create (with members) → rename → change target → add member → remove member → delete", async () => {
    const { db } = await import("@/lib/db");

    // -- create (with one member) --------------------------------------
    vi.mocked(db.contactEmail.findMany).mockResolvedValue([
      { id: "ce1" },
    ] as any);
    vi.mocked(db.contactGroup.create).mockResolvedValue({
      id: "g1",
      name: "Family",
      defaultTarget: "TO",
      userId: USER,
    } as any);
    vi.mocked(db.contactGroupMember.createMany).mockResolvedValue({
      count: 1,
    } as any);
    vi.mocked(db.contactGroup.findMany).mockResolvedValue([groupRow()] as any);

    const list = await listRoute();
    const createRes = await list.POST(
      makeRequest({ name: "Family", memberContactEmailIds: ["ce1"] }),
    );
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    expect(created.group).toEqual({
      id: "g1",
      name: "Family",
      defaultTarget: "TO",
      members: [
        { memberId: "m1", contactEmailId: "ce1", email: "ada@example.com", name: "Ada Lovelace" },
      ],
    });
    expect(db.contactGroupMember.createMany).toHaveBeenCalledWith({
      data: [{ groupId: "g1", contactEmailId: "ce1" }],
    });

    // -- rename ----------------------------------------------------------
    vi.mocked(db.contactGroup.findUnique).mockResolvedValue({
      userId: USER,
    } as any);
    vi.mocked(db.contactGroup.findMany).mockResolvedValue([
      groupRow({ name: "Family Circle" }),
    ] as any);

    const detail = await detailRoute();
    const renameRes = await detail.PATCH(
      makeRequest({ name: "Family Circle" }),
      params({ id: "g1" }),
    );
    expect(renameRes.status).toBe(200);
    expect(db.contactGroup.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { name: "Family Circle" },
    });

    // -- change default target -------------------------------------------
    vi.mocked(db.contactGroup.findMany).mockResolvedValue([
      groupRow({ name: "Family Circle", defaultTarget: "BCC" }),
    ] as any);

    const targetRes = await detail.PATCH(
      makeRequest({ defaultTarget: "BCC" }),
      params({ id: "g1" }),
    );
    expect(targetRes.status).toBe(200);
    expect(db.contactGroup.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { defaultTarget: "BCC" },
    });

    // -- add a member ------------------------------------------------------
    vi.mocked(db.contactEmail.findMany).mockResolvedValue([
      { id: "ce2" },
    ] as any);
    vi.mocked(db.contactGroupMember.findUnique).mockResolvedValue(null);
    vi.mocked(db.contactGroup.findMany).mockResolvedValue([
      groupRow({
        name: "Family Circle",
        defaultTarget: "BCC",
        members: [
          groupRow().members[0],
          {
            id: "m2",
            contactEmailId: "ce2",
            contactEmail: {
              id: "ce2",
              email: "grace@example.com",
              contact: { id: "c2", name: "Grace Hopper" },
            },
          },
        ],
      }),
    ] as any);

    const members = await membersRoute();
    const addRes = await members.POST(
      makeRequest({ contactEmailId: "ce2" }),
      params({ id: "g1" }),
    );
    expect(addRes.status).toBe(200);
    expect(db.contactGroupMember.create).toHaveBeenCalledWith({
      data: { groupId: "g1", contactEmailId: "ce2" },
    });
    const added = await addRes.json();
    expect(added.group.members).toHaveLength(2);

    // -- remove a member -----------------------------------------------
    vi.mocked(db.contactGroupMember.findUnique).mockResolvedValue({
      id: "m2",
      group: { userId: USER },
    } as any);
    vi.mocked(db.contactGroup.findMany).mockResolvedValue([
      groupRow({ name: "Family Circle", defaultTarget: "BCC" }),
    ] as any);

    const member = await memberRoute();
    const removeRes = await member.DELETE(
      makeRequest(),
      params({ id: "g1", memberId: "m2" }),
    );
    expect(removeRes.status).toBe(200);
    expect(db.contactGroupMember.delete).toHaveBeenCalledWith({
      where: { id: "m2" },
    });
    const removed = await removeRes.json();
    expect(removed.group.members).toHaveLength(1);

    // -- delete the group ------------------------------------------------
    const deleteRes = await detail.DELETE(makeRequest(), params({ id: "g1" }));
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ success: true });
    expect(db.contactGroup.delete).toHaveBeenCalledWith({ where: { id: "g1" } });
  });

  it("(c) another user's groupId is a 404", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactGroup.findUnique).mockResolvedValue({
      userId: "someone-else",
    } as any);

    const detail = await detailRoute();
    const renameRes = await detail.PATCH(
      makeRequest({ name: "X" }),
      params({ id: "foreign" }),
    );
    expect(renameRes.status).toBe(404);
    expect(db.contactGroup.update).not.toHaveBeenCalled();

    const deleteRes = await detail.DELETE(
      makeRequest(),
      params({ id: "foreign" }),
    );
    expect(deleteRes.status).toBe(404);
    expect(db.contactGroup.delete).not.toHaveBeenCalled();

    const members = await membersRoute();
    const addRes = await members.POST(
      makeRequest({ contactEmailId: "ce1" }),
      params({ id: "foreign" }),
    );
    expect(addRes.status).toBe(404);
    expect(db.contactGroupMember.create).not.toHaveBeenCalled();

    vi.mocked(db.contactGroupMember.findUnique).mockResolvedValue({
      id: "m9",
      group: { userId: "someone-else" },
    } as any);
    const member = await memberRoute();
    const removeRes = await member.DELETE(
      makeRequest(),
      params({ id: "foreign", memberId: "m9" }),
    );
    expect(removeRes.status).toBe(404);
    expect(db.contactGroupMember.delete).not.toHaveBeenCalled();
  });

  it("(d) a foreign contactEmailId in create/add is rejected (IDOR)", async () => {
    const { db } = await import("@/lib/db");

    // create: the member id doesn't resolve to an owned ContactEmail
    vi.mocked(db.contactEmail.findMany).mockResolvedValue([] as any);
    const list = await listRoute();
    const createRes = await list.POST(
      makeRequest({ name: "X", memberContactEmailIds: ["foreign-ce"] }),
    );
    expect(createRes.status).toBe(404);
    expect(db.contactGroup.create).not.toHaveBeenCalled();

    // add: group is owned, but the contactEmailId isn't
    vi.mocked(db.contactGroup.findUnique).mockResolvedValue({
      userId: USER,
    } as any);
    vi.mocked(db.contactEmail.findMany).mockResolvedValue([] as any);
    const members = await membersRoute();
    const addRes = await members.POST(
      makeRequest({ contactEmailId: "foreign-ce" }),
      params({ id: "g1" }),
    );
    expect(addRes.status).toBe(404);
    expect(db.contactGroupMember.create).not.toHaveBeenCalled();
  });

  it("(e) adding the same member twice is idempotent", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactGroup.findUnique).mockResolvedValue({
      userId: USER,
    } as any);
    vi.mocked(db.contactEmail.findMany).mockResolvedValue([
      { id: "ce1" },
    ] as any);
    vi.mocked(db.contactGroupMember.findUnique).mockResolvedValue({
      id: "m1",
    } as any); // already a member
    vi.mocked(db.contactGroup.findMany).mockResolvedValue([groupRow()] as any);

    const members = await membersRoute();
    const addRes = await members.POST(
      makeRequest({ contactEmailId: "ce1" }),
      params({ id: "g1" }),
    );
    expect(addRes.status).toBe(200);
    expect(db.contactGroupMember.create).not.toHaveBeenCalled();
    const added = await addRes.json();
    expect(added.group.members).toHaveLength(1);
  });

  it("(f) an invalid defaultTarget is a 400 before any db work", async () => {
    const { db } = await import("@/lib/db");

    const list = await listRoute();
    const createRes = await list.POST(
      makeRequest({ name: "X", defaultTarget: "CC" }),
    );
    expect(createRes.status).toBe(400);

    const detail = await detailRoute();
    const patchRes = await detail.PATCH(
      makeRequest({ defaultTarget: "CC" }),
      params({ id: "g1" }),
    );
    expect(patchRes.status).toBe(400);

    expect(db.contactGroup.create).not.toHaveBeenCalled();
    expect(db.contactGroup.update).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
