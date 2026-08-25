import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: { user: { update: vi.fn(), updateMany: vi.fn() } },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function signInAs(id: string) {
  const { requireAuth } = await import("@/lib/auth");
  vi.mocked(requireAuth).mockResolvedValue({ user: { id } } as never);
}

describe("isValidTimeZone", () => {
  it("accepts real IANA zones and UTC, rejects garbage", async () => {
    const { isValidTimeZone } = await import("@/lib/timezone");
    expect(isValidTimeZone("Europe/Stockholm")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("updateTimezone", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an invalid zone without touching the database", async () => {
    await signInAs("user-A");
    const { db } = await import("@/lib/db");
    const { updateTimezone } = await import("@/actions/user");

    await expect(updateTimezone("Not/AZone")).rejects.toThrow(
      "Invalid timezone",
    );
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("writes a valid zone and revalidates the layout", async () => {
    await signInAs("user-A");
    const { db } = await import("@/lib/db");
    const { revalidatePath } = await import("next/cache");
    const { updateTimezone } = await import("@/actions/user");

    await updateTimezone("Europe/Stockholm");

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-A" },
      data: { timezone: "Europe/Stockholm" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("allows choosing UTC explicitly", async () => {
    await signInAs("user-A");
    const { db } = await import("@/lib/db");
    const { updateTimezone } = await import("@/actions/user");

    await updateTimezone("UTC");

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-A" },
      data: { timezone: "UTC" },
    });
  });
});

describe("adoptTimezone", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only writes while the account has never chosen a zone", async () => {
    await signInAs("user-A");
    const { db } = await import("@/lib/db");
    vi.mocked(db.user.updateMany).mockResolvedValue({ count: 1 } as never);
    const { adoptTimezone } = await import("@/actions/user");

    await expect(adoptTimezone("Europe/Stockholm")).resolves.toBe(true);

    // The null guard in the where is the whole point: an explicit choice
    // in Settings must never be overwritten by a later browser visit.
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-A", timezone: null },
      data: { timezone: "Europe/Stockholm" },
    });
  });

  it("reports false and skips revalidation when a zone already exists", async () => {
    await signInAs("user-A");
    const { db } = await import("@/lib/db");
    vi.mocked(db.user.updateMany).mockResolvedValue({ count: 0 } as never);
    const { revalidatePath } = await import("next/cache");
    const { adoptTimezone } = await import("@/actions/user");

    await expect(adoptTimezone("Europe/Stockholm")).resolves.toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an invalid zone without touching the database", async () => {
    await signInAs("user-A");
    const { db } = await import("@/lib/db");
    const { adoptTimezone } = await import("@/actions/user");

    await expect(adoptTimezone("<script>")).rejects.toThrow(
      "Invalid timezone",
    );
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
});
