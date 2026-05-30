import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    sender: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

describe("setSenderImagePolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null);

    const { setSenderImagePolicy } = await import("@/actions/image-policy");
    await expect(setSenderImagePolicy("sender-1", true)).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("throws when the sender is owned by another user", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { db } = await import("@/lib/db");
    vi.mocked(db.sender.findUnique).mockResolvedValue({
      userId: "user-2",
    } as never);

    const { setSenderImagePolicy } = await import("@/actions/image-policy");
    await expect(setSenderImagePolicy("sender-1", true)).rejects.toThrow(
      "Sender not found",
    );
    expect(db.sender.update).not.toHaveBeenCalled();
  });

  it("updates allowRemoteImages for an owned sender and revalidates", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { db } = await import("@/lib/db");
    vi.mocked(db.sender.findUnique).mockResolvedValue({
      userId: "user-1",
    } as never);
    vi.mocked(db.sender.update).mockResolvedValue({} as never);

    const { updateTag } = await import("next/cache");
    const { setSenderImagePolicy } = await import("@/actions/image-policy");
    await setSenderImagePolicy("sender-1", true);

    expect(db.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: { allowRemoteImages: true },
    });
    expect(vi.mocked(updateTag)).toHaveBeenCalledWith("sidebar-counts");
  });
});

describe("setBlockRemoteImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when not authenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue(null);

    const { setBlockRemoteImages } = await import("@/actions/image-policy");
    await expect(setBlockRemoteImages(false)).rejects.toThrow("Unauthorized");
  });

  it("writes the user preference", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);

    const { db } = await import("@/lib/db");
    vi.mocked(db.user.update).mockResolvedValue({} as never);

    const { setBlockRemoteImages } = await import("@/actions/image-policy");
    await setBlockRemoteImages(false);

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { blockRemoteImages: false },
    });
  });
});
