import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    calendarEventInstance: { findMany: (...args: unknown[]) => findMany(...args) },
  },
}));

import { loadScheduleInstances, slotLines } from "@/lib/mail/person-schedule";

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

  it("carries each event's travel time, so time spent getting there is not offered as free", async () => {
    findMany.mockResolvedValue([
      {
        startAt: new Date("2026-09-08T12:00:00.000Z"),
        endAt: new Date("2026-09-08T13:00:00.000Z"),
        isAllDay: false,
        isCancelled: false,
        event: { transparency: "busy", travelMinutes: 30 },
      },
    ]);

    const [instance] = await loadScheduleInstances(
      "u1",
      new Date("2026-09-08T10:00:00.000Z"),
    );

    expect(instance.travelMinutes).toBe(30);
    const arg = findMany.mock.calls[0][0] as {
      select: { event: { select: Record<string, boolean> } };
    };
    expect(arg.select.event.select.travelMinutes).toBe(true);
  });

  it("offers a contact no time that is spent getting to an event", async () => {
    findMany.mockResolvedValue([
      {
        startAt: new Date("2026-09-09T12:00:00.000Z"),
        endAt: new Date("2026-09-09T13:00:00.000Z"),
        isAllDay: false,
        isCancelled: false,
        event: { transparency: "busy", travelMinutes: 45 },
      },
    ]);
    const now = new Date("2026-09-08T10:00:00.000Z");

    const instances = await loadScheduleInstances("u1", now);
    const wednesday = slotLines(instances, now, "UTC").filter((line) =>
      line.startsWith("Wed 9 Sep"),
    );

    expect(wednesday).toEqual([
      "Wed 9 Sep, 07:00-11:15",
      "Wed 9 Sep, 13:00-21:00",
    ]);
  });
});
