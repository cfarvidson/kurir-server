import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    contactGroup: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    contactGroupMember: {
      create: vi.fn(),
      createMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    contactEmail: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const authed = (id = "user-1") =>
  import("@/lib/auth").then(({ auth }) =>
    vi.mocked(auth).mockResolvedValue({ user: { id } } as any),
  );

describe("createGroup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null as never);
    const { createGroup } = await import("@/actions/contact-groups");
    await expect(createGroup({ name: "Family" })).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("throws when name is empty", async () => {
    await authed();
    const { createGroup } = await import("@/actions/contact-groups");
    await expect(createGroup({ name: "  " })).rejects.toThrow(
      "Name is required",
    );
  });

  it("creates a group with two members", async () => {
    await authed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactEmail.findMany).mockResolvedValue([
      { id: "ce-1" },
      { id: "ce-2" },
    ] as any);
    vi.mocked(db.$transaction).mockImplementation(async (fn: any) => {
      const tx = {
        contactGroup: {
          create: vi.fn().mockResolvedValue({ id: "group-1" }),
        },
        contactGroupMember: {
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
      };
      return fn(tx);
    });

    const { createGroup } = await import("@/actions/contact-groups");
    const result = await createGroup({
      name: "Family",
      defaultTarget: "TO",
      memberContactEmailIds: ["ce-1", "ce-2"],
    });

    expect(result).toBe("group-1");
  });

  it("rejects member ids not owned by the caller", async () => {
    await authed();
    const { db } = await import("@/lib/db");
    // Only one of two ids resolves under contact: { userId }
    vi.mocked(db.contactEmail.findMany).mockResolvedValue([{ id: "ce-1" }] as any);

    const { createGroup } = await import("@/actions/contact-groups");
    await expect(
      createGroup({
        name: "Family",
        memberContactEmailIds: ["ce-1", "ce-foreign"],
      }),
    ).rejects.toThrow("Contact email not found");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("renameGroup / setGroupDefaultTarget", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renameGroup rejects a group owned by another user", async () => {
    await authed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactGroup.findUnique).mockResolvedValue({
      userId: "other-user",
    } as any);

    const { renameGroup } = await import("@/actions/contact-groups");
    await expect(renameGroup("group-1", "New")).rejects.toThrow(
      "Group not found",
    );
    expect(db.contactGroup.update).not.toHaveBeenCalled();
  });

  it("setGroupDefaultTarget updates an owned group", async () => {
    await authed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactGroup.findUnique).mockResolvedValue({
      userId: "user-1",
    } as any);

    const { setGroupDefaultTarget } = await import("@/actions/contact-groups");
    await setGroupDefaultTarget("group-1", "BCC");
    expect(db.contactGroup.update).toHaveBeenCalledWith({
      where: { id: "group-1" },
      data: { defaultTarget: "BCC" },
    });
  });

  it("setGroupDefaultTarget rejects a group owned by another user", async () => {
    await authed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactGroup.findUnique).mockResolvedValue({
      userId: "other-user",
    } as any);

    const { setGroupDefaultTarget } = await import("@/actions/contact-groups");
    await expect(setGroupDefaultTarget("group-1", "BCC")).rejects.toThrow(
      "Group not found",
    );
    expect(db.contactGroup.update).not.toHaveBeenCalled();
  });
});

describe("deleteGroup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes an owned group (members cascade)", async () => {
    await authed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactGroup.findUnique).mockResolvedValue({
      userId: "user-1",
    } as any);

    const { deleteGroup } = await import("@/actions/contact-groups");
    await deleteGroup("group-1");
    expect(db.contactGroup.delete).toHaveBeenCalledWith({
      where: { id: "group-1" },
    });
  });

  it("rejects deleting a group owned by another user", async () => {
    await authed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactGroup.findUnique).mockResolvedValue({
      userId: "other-user",
    } as any);

    const { deleteGroup } = await import("@/actions/contact-groups");
    await expect(deleteGroup("group-1")).rejects.toThrow("Group not found");
    expect(db.contactGroup.delete).not.toHaveBeenCalled();
  });
});

describe("addGroupMember", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds a member to an owned group", async () => {
    await authed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactGroup.findUnique).mockResolvedValue({
      userId: "user-1",
    } as any);
    vi.mocked(db.contactEmail.findMany).mockResolvedValue([{ id: "ce-1" }] as any);
    vi.mocked(db.contactGroupMember.findUnique).mockResolvedValue(null);

    const { addGroupMember } = await import("@/actions/contact-groups");
    await addGroupMember("group-1", "ce-1");
    expect(db.contactGroupMember.create).toHaveBeenCalledWith({
      data: { groupId: "group-1", contactEmailId: "ce-1" },
    });
  });

  it("does not duplicate an existing member", async () => {
    await authed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactGroup.findUnique).mockResolvedValue({
      userId: "user-1",
    } as any);
    vi.mocked(db.contactEmail.findMany).mockResolvedValue([{ id: "ce-1" }] as any);
    vi.mocked(db.contactGroupMember.findUnique).mockResolvedValue({
      id: "member-1",
    } as any);

    const { addGroupMember } = await import("@/actions/contact-groups");
    await addGroupMember("group-1", "ce-1");
    expect(db.contactGroupMember.create).not.toHaveBeenCalled();
  });

  it("rejects adding to a group owned by another user", async () => {
    await authed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactGroup.findUnique).mockResolvedValue({
      userId: "other-user",
    } as any);

    const { addGroupMember } = await import("@/actions/contact-groups");
    await expect(addGroupMember("group-1", "ce-1")).rejects.toThrow(
      "Group not found",
    );
    // Must not reach the email-ownership check or create the member.
    expect(db.contactEmail.findMany).not.toHaveBeenCalled();
    expect(db.contactGroupMember.create).not.toHaveBeenCalled();
  });

  it("rejects a contactEmailId belonging to another user (IDOR guard)", async () => {
    await authed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactGroup.findUnique).mockResolvedValue({
      userId: "user-1",
    } as any);
    // The foreign email does not resolve under contact: { userId }
    vi.mocked(db.contactEmail.findMany).mockResolvedValue([] as any);

    const { addGroupMember } = await import("@/actions/contact-groups");
    await expect(addGroupMember("group-1", "ce-foreign")).rejects.toThrow(
      "Contact email not found",
    );
    expect(db.contactGroupMember.create).not.toHaveBeenCalled();
  });
});

describe("removeGroupMember", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a member whose group belongs to another user", async () => {
    await authed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactGroupMember.findUnique).mockResolvedValue({
      id: "member-1",
      group: { userId: "other-user" },
    } as any);

    const { removeGroupMember } = await import("@/actions/contact-groups");
    await expect(removeGroupMember("member-1")).rejects.toThrow(
      "Group member not found",
    );
    expect(db.contactGroupMember.delete).not.toHaveBeenCalled();
  });

  it("removes an owned member", async () => {
    await authed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactGroupMember.findUnique).mockResolvedValue({
      id: "member-1",
      group: { userId: "user-1" },
    } as any);

    const { removeGroupMember } = await import("@/actions/contact-groups");
    await removeGroupMember("member-1");
    expect(db.contactGroupMember.delete).toHaveBeenCalledWith({
      where: { id: "member-1" },
    });
  });
});

describe("listGroups", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the caller's groups with flattened members", async () => {
    await authed();
    const { db } = await import("@/lib/db");
    vi.mocked(db.contactGroup.findMany).mockResolvedValue([
      {
        id: "group-1",
        name: "Family",
        defaultTarget: "TO",
        members: [
          {
            id: "member-1",
            contactEmailId: "ce-1",
            contactEmail: {
              id: "ce-1",
              email: "alice@example.com",
              contact: { id: "c-1", name: "Alice" },
            },
          },
        ],
      },
    ] as any);

    const { listGroups } = await import("@/actions/contact-groups");
    const result = await listGroups();
    expect(result).toEqual([
      {
        id: "group-1",
        name: "Family",
        defaultTarget: "TO",
        members: [
          {
            memberId: "member-1",
            contactEmailId: "ce-1",
            email: "alice@example.com",
            name: "Alice",
          },
        ],
      },
    ]);
    // userId scoping
    expect(db.contactGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } }),
    );
  });
});
