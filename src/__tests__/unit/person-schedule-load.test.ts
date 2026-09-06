import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    calendarEventInstance: { findMany: (...args: unknown[]) => findMany(...args) },
  },
}));

import { loadScheduleInstances } from "@/lib/mail/person-schedule";

describe("loadScheduleInstances", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([]);
  });

  it("filters instances to a near-term overlap window", async () => {
    const now = new Date("2026-09-08T10:00:00.000Z");
    await loadScheduleInstances("u1", now);
    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0] as {
      where: { userId: string; startAt: { lt: Date }; endAt: { gt: Date } };
    };
    expect(arg.where.userId).toBe("u1");
    expect(arg.where.startAt.lt.getTime()).toBe(
      now.getTime() + 16 * 86_400_000,
    );
    expect(arg.where.endAt.gt.getTime()).toBe(now.getTime() - 1 * 86_400_000);
  });
});
