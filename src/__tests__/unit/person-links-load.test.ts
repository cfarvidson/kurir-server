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

  it("drops a path that repeats across many mails, keeps a one-off", async () => {
    const day = (n: number) => new Date(Date.UTC(2026, 0, n));
    findMany.mockResolvedValue([
      {
        id: "m3",
        textBody:
          "https://app.example.com/footer-cta https://app.example.com/reports/q3",
        receivedAt: day(3),
      },
      {
        id: "m2",
        textBody: "https://app.example.com/footer-cta",
        receivedAt: day(2),
      },
      {
        id: "m1",
        textBody: "https://app.example.com/footer-cta",
        receivedAt: day(1),
      },
    ]);
    const links = await loadPersonLinks("u1", "ada@x.y");
    expect(links.map((l) => l.id)).toEqual(["app.example.com/reports/q3"]);
  });
});
