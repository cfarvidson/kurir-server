import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    message: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

// Run the deferred IMAP push inline so the test can assert on it.
vi.mock("next/server", () => ({
  after: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/lib/mail/flag-push", () => ({
  pushFlagsToImap: vi.fn().mockResolvedValue(undefined),
  suppressEcho: vi.fn(),
}));

async function authed() {
  const { auth } = await import("@/lib/auth");
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
}

function seedThread() {
  return import("@/lib/db").then(({ db }) => {
    vi.mocked(db.message.findFirst).mockResolvedValue({
      id: "m1",
      threadId: "t1",
      emailConnectionId: "c1",
      uid: 5,
      folderId: "f1",
      sender: { category: "IMBOX" },
    } as never);
    vi.mocked(db.message.findMany).mockResolvedValue([
      { id: "m1", uid: 5, folderId: "f1" },
      { id: "m2", uid: 6, folderId: "f1" },
    ] as never);
    vi.mocked(db.message.updateMany).mockResolvedValue({ count: 2 } as never);
    return db;
  });
}

describe("setPinned (plan 056)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null as never);

    const { setPinned } = await import("@/actions/pin");
    await expect(setPinned("m1", true)).rejects.toThrow("Unauthorized");
  });

  it("pins the whole thread and pushes \\Flagged to IMAP, touching nothing else", async () => {
    await authed();
    const db = await seedThread();
    const { pushFlagsToImap } = await import("@/lib/mail/flag-push");
    const { revalidatePath, updateTag } = await import("next/cache");

    const { setPinned } = await import("@/actions/pin");
    await setPinned("m1", true);

    expect(db.message.updateMany).toHaveBeenCalledTimes(1);
    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1", "m2"] } },
      data: { isFlagged: true },
    });
    expect(pushFlagsToImap).toHaveBeenCalledWith(
      "user-1",
      [
        { uid: 5, folderId: "f1" },
        { uid: 6, folderId: "f1" },
      ],
      "\\Flagged",
      "add",
    );
    expect(vi.mocked(updateTag)).toHaveBeenCalledWith("sidebar-counts");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/pinned");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/archive");
  });

  it("unpins by removing \\Flagged", async () => {
    await authed();
    const db = await seedThread();
    const { pushFlagsToImap } = await import("@/lib/mail/flag-push");

    const { setPinned } = await import("@/actions/pin");
    await setPinned("m1", false);

    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1", "m2"] } },
      data: { isFlagged: false },
    });
    expect(pushFlagsToImap).toHaveBeenLastCalledWith(
      "user-1",
      expect.any(Array),
      "\\Flagged",
      "remove",
    );
  });
});

describe("archive keeps the pin", () => {
  it("ARCHIVE_CLEAR_DATA never touches isFlagged", async () => {
    const { ARCHIVE_CLEAR_DATA } = await import("@/lib/mail/mutations");
    expect(ARCHIVE_CLEAR_DATA).not.toHaveProperty("isFlagged");
  });
});
