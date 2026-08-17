import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: vi.fn() } },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

vi.mock("@/lib/mail/settings-backup", () => ({
  listSettingsBackupsForUser: vi.fn(),
  writeSettingsBackupForUser: vi.fn(),
  setSettingsBackupCadenceForUser: vi.fn(),
  restoreSettingsBackupFromMessageForUser: vi.fn(),
}));

describe("settings-backup actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated backup now", async () => {
    const { requireAuth } = await import("@/lib/auth");
    vi.mocked(requireAuth).mockRejectedValue(new Error("Unauthorized"));

    const { backupSettingsNow } = await import("@/actions/settings-backup");
    await expect(backupSettingsNow()).rejects.toThrow("Unauthorized");
  });

  it("rejects an invalid cadence", async () => {
    const { requireAuth } = await import("@/lib/auth");
    vi.mocked(requireAuth).mockResolvedValue({
      user: { id: "user-1" },
    } as never);

    const { setSettingsBackupCadence } = await import(
      "@/actions/settings-backup"
    );
    await expect(setSettingsBackupCadence("monthly")).rejects.toThrow(
      "Invalid cadence",
    );
  });
});
