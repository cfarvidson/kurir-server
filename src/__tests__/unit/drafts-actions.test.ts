import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "u1" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    draft: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    attachment: { count: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { saveDraft } from "@/actions/drafts";

describe("saveDraft action", () => {
  it("refuses more than 50 contact groups before saving", async () => {
    const groups = Array.from({ length: 51 }, (_, i) => ({
      groupId: `g${i}`,
      target: "TO" as const,
      removedEmails: [],
    }));
    await expect(
      saveDraft({ type: "NEW", contextMessageId: "c1", groups }),
    ).rejects.toThrow("A draft holds at most 50 contact groups");
    expect(db.draft.upsert).not.toHaveBeenCalled();
  });
});
