import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { message: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

import { loadPersonLinks } from "@/lib/mail/person-links";

describe("loadPersonLinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([]);
  });

  it("selects textBody only and caps at 40 rows", async () => {
    await loadPersonLinks("u1", "ada@x.y");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, textBody: true, receivedAt: true },
        take: 40,
      }),
    );
    const select = findMany.mock.calls[0][0].select as Record<string, boolean>;
    expect(select.htmlBody).toBeUndefined();
  });
});
