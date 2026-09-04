import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { sender: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

import {
  SCREENED_SENDERS_TAKE,
  getScreenedSenders,
} from "@/lib/mail/screener-list";

describe("getScreenedSenders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([]);
  });

  it("caps at 200 and selects messageCount instead of _count", async () => {
    await getScreenedSenders("u1", ["me@example.com"]);
    expect(SCREENED_SENDERS_TAKE).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 200,
        orderBy: { decidedAt: "desc" },
        select: expect.objectContaining({
          messageCount: true,
        }),
      }),
    );
    const arg = findMany.mock.calls[0][0] as {
      select: Record<string, unknown>;
    };
    expect(arg.select._count).toBeUndefined();
  });
});
