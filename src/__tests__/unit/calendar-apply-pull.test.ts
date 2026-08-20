import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import {
  expandEventWindow,
  instanceWindow,
  type EventMaster,
} from "@/lib/calendar/expand";
import type { PullResult, RemoteEvent } from "@/lib/calendar/providers/types";

vi.mock("@/lib/db", () => {
  const calendarEvent = {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  };
  const calendarEventInstance = {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  };
  const calendarTombstone = {
    createMany: vi.fn(),
  };
  return {
    db: {
      calendarEvent,
      calendarEventInstance,
      calendarTombstone,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ calendarEvent, calendarEventInstance, calendarTombstone }),
      ),
    },
  };
});

const now = new Date("2026-08-20T12:00:00.000Z");

function remote(
  partial: Partial<RemoteEvent> & Pick<RemoteEvent, "providerEventId">,
): RemoteEvent {
  return {
    icalUid: null,
    etag: null,
    sequence: 0,
    title: "Event",
    description: null,
    location: null,
    startAt: new Date("2026-08-20T10:00:00.000Z"),
    endAt: new Date("2026-08-20T11:00:00.000Z"),
    isAllDay: false,
    timezone: "UTC",
    status: "confirmed",
    transparency: "busy",
    rrule: null,
    rdate: null,
    exdate: null,
    masterProviderEventId: null,
    recurrenceId: null,
    organizerJson: null,
    attendeesJson: null,
    rawJson: null,
    ...partial,
  };
}

function replicaRow(
  partial: {
    id: string;
    providerEventId: string;
    icalUid?: string | null;
    recurrenceId?: Date | null;
    masterEventId?: string | null;
    title?: string;
    startAt?: Date;
    endAt?: Date;
    rrule?: string | null;
    status?: string;
  },
) {
  return {
    calendarId: "cal1",
    userId: "u1",
    icalUid: null,
    recurrenceId: null,
    masterEventId: null,
    title: "Event",
    startAt: new Date("2026-08-20T10:00:00.000Z"),
    endAt: new Date("2026-08-20T11:00:00.000Z"),
    isAllDay: false,
    timezone: "UTC",
    rrule: null,
    rdate: null,
    exdate: null,
    transparency: "busy",
    status: "confirmed",
    ...partial,
  };
}

function pull(partial: Partial<PullResult> & Pick<PullResult, "upserts">): PullResult {
  return {
    deletedProviderIds: [],
    cursor: null,
    reset: false,
    complete: false,
    ...partial,
  };
}

function collectIn(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object") return [];
  const rec = value as Record<string, unknown>;
  const out: string[] = [];
  const field = rec[key];
  if (field && typeof field === "object" && "in" in field) {
    const inner = (field as { in?: unknown }).in;
    if (Array.isArray(inner)) out.push(...inner.map(String));
  }
  for (const child of Object.values(rec)) {
    out.push(...collectIn(child, key));
  }
  return out;
}

function collectNotIn(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const rec = value as Record<string, unknown>;
  const out: string[] = [];
  for (const [k, child] of Object.entries(rec)) {
    if (k === "notIn" && Array.isArray(child)) out.push(...child.map(String));
    out.push(...collectNotIn(child));
  }
  return out;
}

describe("applyPull", () => {
  beforeEach(() => vi.clearAllMocks());

  async function setupMocks(existing: ReturnType<typeof replicaRow>[]) {
    const { db } = await import("@/lib/db");
    vi.mocked(db.calendarEvent.findMany).mockResolvedValue(existing as never);
    vi.mocked(db.calendarEvent.upsert).mockImplementation(async (args) => {
      const pid = (
        args as {
          where: { calendarId_providerEventId: { providerEventId: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }
      ).where.calendarId_providerEventId.providerEventId;
      const create = (
        args as { create: Record<string, unknown>; update: Record<string, unknown> }
      ).create;
      const update = (
        args as { create: Record<string, unknown>; update: Record<string, unknown> }
      ).update;
      const found = existing.find((row) => row.providerEventId === pid);
      if (found) return { ...found, ...update, id: found.id } as never;
      return { id: `id-${pid}`, ...create } as never;
    });
    vi.mocked(db.calendarEvent.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(db.calendarEventInstance.deleteMany).mockResolvedValue({
      count: 0,
    } as never);
    vi.mocked(db.calendarEventInstance.createMany).mockResolvedValue({
      count: 0,
    } as never);
    vi.mocked(db.calendarTombstone.createMany).mockResolvedValue({
      count: 0,
    } as never);
    vi.mocked(db.$transaction).mockImplementation(async (fn) =>
      (
        fn as (tx: {
          calendarEvent: typeof db.calendarEvent;
          calendarEventInstance: typeof db.calendarEventInstance;
          calendarTombstone: typeof db.calendarTombstone;
        }) => unknown
      )({
        calendarEvent: db.calendarEvent,
        calendarEventInstance: db.calendarEventInstance,
        calendarTombstone: db.calendarTombstone,
      }),
    );
    return db;
  }

  it("does not mass-delete on an incomplete pull (reset does not change that)", async () => {
    const db = await setupMocks([
      replicaRow({ id: "e-keep", providerEventId: "keep" }),
      replicaRow({ id: "e-leftover", providerEventId: "leftover" }),
      replicaRow({ id: "e-gone", providerEventId: "gone" }),
    ]);

    const { applyPull } = await import("@/lib/calendar/apply-pull");
    const result = await applyPull({
      userId: "u1",
      accountId: "acc1",
      calendarId: "cal1",
      now,
      pull: pull({
        upserts: [remote({ providerEventId: "keep", title: "Keep" })],
        deletedProviderIds: ["gone"],
        reset: true,
        complete: false,
      }),
    });

    expect(result).toEqual({ upserted: 1, deleted: 1 });
    expect(db.calendarEvent.deleteMany).toHaveBeenCalledTimes(1);
    const where = vi.mocked(db.calendarEvent.deleteMany).mock.calls[0][0]
      .where as Record<string, unknown>;
    expect(collectNotIn(where)).toEqual([]);
    const deletedProviders = collectIn(where, "providerEventId");
    const deletedIds = collectIn(where, "id");
    if (deletedProviders.length > 0) {
      expect(deletedProviders).toEqual(["gone"]);
    } else {
      expect(deletedIds).toEqual(["e-gone"]);
    }
    expect(deletedProviders).not.toContain("leftover");
    expect(deletedIds).not.toContain("e-leftover");

    expect(db.calendarTombstone.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            eventId: "e-gone",
            providerEventId: "gone",
            userId: "u1",
          }),
        ],
      }),
    );
  });

  it("deletes replica events missing from a complete pull", async () => {
    const db = await setupMocks([
      replicaRow({ id: "e-keep", providerEventId: "keep" }),
      replicaRow({ id: "e-missing", providerEventId: "missing" }),
      replicaRow({ id: "e-gone", providerEventId: "gone" }),
    ]);

    const { applyPull } = await import("@/lib/calendar/apply-pull");
    const result = await applyPull({
      userId: "u1",
      accountId: "acc1",
      calendarId: "cal1",
      now,
      pull: pull({
        upserts: [remote({ providerEventId: "keep", title: "Keep" })],
        deletedProviderIds: ["gone"],
        reset: false,
        complete: true,
      }),
    });

    expect(result).toEqual({ upserted: 1, deleted: 2 });
    expect(db.calendarEvent.deleteMany).toHaveBeenCalledTimes(1);
    const where = vi.mocked(db.calendarEvent.deleteMany).mock.calls[0][0]
      .where as Record<string, unknown>;
    const deletedProviders = collectIn(where, "providerEventId");
    const deletedIds = collectIn(where, "id");
    if (deletedProviders.length > 0) {
      expect(deletedProviders.sort()).toEqual(["gone", "missing"]);
    } else {
      expect(deletedIds.sort()).toEqual(["e-gone", "e-missing"]);
    }

    const tombstoneData = vi.mocked(db.calendarTombstone.createMany).mock
      .calls[0][0].data as Array<{ eventId: string; providerEventId: string }>;
    expect(tombstoneData).toHaveLength(2);
    expect(tombstoneData.map((t) => t.providerEventId).sort()).toEqual([
      "gone",
      "missing",
    ]);
    expect(tombstoneData.map((t) => t.eventId).sort()).toEqual([
      "e-gone",
      "e-missing",
    ]);
  });

  it("rebuilds instances for an upserted master inside instanceWindow(now)", async () => {
    const db = await setupMocks([]);
    const masterRemote = remote({
      providerEventId: "standup",
      icalUid: "standup@x",
      title: "Standup",
      startAt: new Date("2026-08-17T08:00:00.000Z"),
      endAt: new Date("2026-08-17T08:15:00.000Z"),
      rrule: "FREQ=DAILY;COUNT=5",
    });

    const { applyPull } = await import("@/lib/calendar/apply-pull");
    await applyPull({
      userId: "u1",
      accountId: "acc1",
      calendarId: "cal1",
      now,
      pull: pull({
        upserts: [masterRemote],
        complete: false,
      }),
    });

    const master: EventMaster = {
      id: "id-standup",
      title: "Standup",
      startAt: masterRemote.startAt,
      endAt: masterRemote.endAt,
      isAllDay: false,
      timezone: "UTC",
      rrule: "FREQ=DAILY;COUNT=5",
      rdate: null,
      exdate: null,
      transparency: "busy",
      status: "confirmed",
    };
    const { from, to } = instanceWindow(now);
    const expected = expandEventWindow(master, [], from, to);

    expect(db.calendarEventInstance.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: "u1",
        calendarId: "cal1",
        eventId: { in: ["id-standup"] },
      }),
    });
    expect(db.calendarEventInstance.createMany).toHaveBeenCalledWith({
      data: expected.map((row) => ({
        startAt: row.startAt,
        endAt: row.endAt,
        isAllDay: row.isAllDay,
        isCancelled: row.isCancelled,
        isException: row.isException,
        eventId: "id-standup",
        calendarId: "cal1",
        userId: "u1",
      })),
    });
  });

  it("joins CalDAV exceptions via icalUid when masterProviderEventId is missing", async () => {
    const db = await setupMocks([
      replicaRow({
        id: "e-master",
        providerEventId: "href-master",
        icalUid: "series@x",
        title: "Standup",
        startAt: new Date("2026-08-17T08:00:00.000Z"),
        endAt: new Date("2026-08-17T08:15:00.000Z"),
        rrule: "FREQ=DAILY;COUNT=5",
      }),
    ]);

    const { applyPull } = await import("@/lib/calendar/apply-pull");
    await applyPull({
      userId: "u1",
      accountId: "acc1",
      calendarId: "cal1",
      now,
      pull: pull({
        upserts: [
          remote({
            providerEventId: "href-ex",
            icalUid: "series@x",
            title: "Standup (moved)",
            startAt: new Date("2026-08-18T09:00:00.000Z"),
            endAt: new Date("2026-08-18T09:15:00.000Z"),
            masterProviderEventId: null,
            recurrenceId: new Date("2026-08-18T08:00:00.000Z"),
          }),
        ],
        complete: false,
      }),
    });

    const upsertArg = vi.mocked(db.calendarEvent.upsert).mock.calls[0][0];
    expect(upsertArg.create).toMatchObject({ masterEventId: "e-master" });
    expect(upsertArg.update).toMatchObject({ masterEventId: "e-master" });

    const created = vi.mocked(db.calendarEventInstance.createMany).mock
      .calls[0][0].data as Array<{
      startAt: Date;
      isException: boolean;
      title?: string;
    }>;
    const moved = created.find(
      (row) => row.startAt.toISOString() === "2026-08-18T09:00:00.000Z",
    );
    expect(moved?.isException).toBe(true);
  });

  it("maps top-level null JSON fields to Prisma.DbNull", async () => {
    const db = await setupMocks([]);
    const { applyPull } = await import("@/lib/calendar/apply-pull");
    await applyPull({
      userId: "u1",
      accountId: "acc1",
      calendarId: "cal1",
      now,
      pull: pull({
        upserts: [remote({ providerEventId: "keep" })],
      }),
    });

    const args = vi.mocked(db.calendarEvent.upsert).mock.calls[0][0];
    for (const payload of [args.create, args.update]) {
      expect(payload.organizerJson).toBe(Prisma.DbNull);
      expect(payload.attendeesJson).toBe(Prisma.DbNull);
      expect(payload.rawJson).toBe(Prisma.DbNull);
      expect(payload.organizerJson).not.toBeNull();
      expect(payload.attendeesJson).not.toBeNull();
      expect(payload.rawJson).not.toBeNull();
    }
  });

  it("applies replica writes inside db.$transaction", async () => {
    const db = await setupMocks([
      replicaRow({ id: "e-keep", providerEventId: "keep" }),
      replicaRow({ id: "e-gone", providerEventId: "gone" }),
    ]);
    const order: string[] = [];
    const tx = {
      calendarEvent: db.calendarEvent,
      calendarEventInstance: db.calendarEventInstance,
      calendarTombstone: db.calendarTombstone,
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) => {
      order.push("tx-start");
      const result = await (fn as (client: typeof tx) => unknown)(tx);
      order.push("tx-end");
      return result;
    });
    function wrap(
      name: string,
      mock: {
        getMockImplementation: () => ((...args: never[]) => unknown) | undefined;
        mockImplementation: (fn: (...args: never[]) => unknown) => unknown;
      },
    ) {
      const inner = mock.getMockImplementation();
      mock.mockImplementation((...args: never[]) => {
        order.push(name);
        return inner ? inner(...args) : undefined;
      });
    }
    wrap("upsert", db.calendarEvent.upsert);
    wrap("tombstone", db.calendarTombstone.createMany);
    wrap("delete", db.calendarEvent.deleteMany);

    const { applyPull } = await import("@/lib/calendar/apply-pull");
    await applyPull({
      userId: "u1",
      accountId: "acc1",
      calendarId: "cal1",
      now,
      pull: pull({
        upserts: [remote({ providerEventId: "keep", title: "Keep" })],
        deletedProviderIds: ["gone"],
        complete: false,
      }),
    });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.$transaction).mock.calls[0][0]).toBeTypeOf("function");
    expect(order[0]).toBe("tx-start");
    expect(order.at(-1)).toBe("tx-end");
    const inner = order.slice(1, -1);
    expect(inner).toContain("upsert");
    expect(inner).toContain("tombstone");
    expect(inner).toContain("delete");
  });
});

