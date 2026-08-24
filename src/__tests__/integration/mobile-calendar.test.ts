/**
 * Integration tests for /api/mobile/calendar/* - auth, range validation,
 * read-only writes, and the shared write/query cores. The db and write
 * helpers are mocked so route wiring is exercised without provider HTTP.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CalendarWriteError } from "@/lib/calendar/write";

vi.mock("@/lib/db", () => ({
  db: {
    calendarAccount: { findMany: vi.fn(), findFirst: vi.fn() },
    calendar: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    calendarEvent: { findMany: vi.fn() },
    calendarTombstone: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/mobile/auth", () => ({
  requireMobileAuth: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    rateLimitUser: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 100, retryAfter: 0 }),
  };
});

vi.mock("@/lib/calendar/write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calendar/write")>();
  return {
    ...actual,
    createEventForUser: vi.fn(),
    updateEventForUser: vi.fn(),
    deleteEventForUser: vi.fn(),
  };
});

vi.mock("@/lib/calendar/query", () => ({
  listVisibleInstancesForUser: vi.fn(),
}));

vi.mock("@/lib/calendar/accounts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/calendar/accounts")>();
  return {
    ...actual,
    createCalDavAccount: vi.fn(),
    deleteCalendarAccount: vi.fn(),
    setCalendarVisibleForUser: vi.fn(),
  };
});

vi.mock("@/lib/calendar/rsvp", () => ({
  rsvpToMeetingForUser: vi.fn(),
}));

vi.mock("@/lib/calendar/ics-account", () => ({
  createIcsAccount: vi.fn(),
}));

function makeGet(params: Record<string, string> = {}) {
  const searchParams = new URLSearchParams(params);
  return {
    headers: { get: () => null },
    nextUrl: { searchParams },
  } as never;
}

function makeBody(body: unknown) {
  return {
    headers: { get: () => null },
    json: async () => body,
    nextUrl: { searchParams: new URLSearchParams() },
  } as never;
}

async function mockAuthed(userId = "user-1") {
  const { requireMobileAuth } = await import("@/lib/mobile/auth");
  vi.mocked(requireMobileAuth).mockResolvedValue({ userId });
}

async function mockUnauthed() {
  const { requireMobileAuth } = await import("@/lib/mobile/auth");
  vi.mocked(requireMobileAuth).mockResolvedValue(null);
}

const params = <T extends Record<string, string>>(p: T) => ({
  params: Promise.resolve(p),
});

const EVENT_BODY = {
  calendarId: "cal-1",
  title: "Standup",
  description: null,
  location: null,
  startAt: "2026-08-20T09:00:00.000Z",
  endAt: "2026-08-20T09:30:00.000Z",
  isAllDay: false,
  timezone: "UTC",
  rrule: null,
};

describe("/api/mobile/calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /accounts without bearer auth returns 401", async () => {
    await mockUnauthed();
    const { GET } = await import("@/app/api/mobile/calendar/accounts/route");
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("GET /range without a valid start/end returns 400", async () => {
    await mockAuthed();
    const { GET } = await import("@/app/api/mobile/calendar/range/route");

    const missing = await GET(makeGet());
    expect(missing.status).toBe(400);

    const bad = await GET(makeGet({ start: "not-a-date", end: "also-bad" }));
    expect(bad.status).toBe(400);

    const inverted = await GET(
      makeGet({
        start: "2026-08-21T00:00:00.000Z",
        end: "2026-08-20T00:00:00.000Z",
      }),
    );
    expect(inverted.status).toBe(400);
  });

  it("POST /events returns 403 when the calendar is read-only", async () => {
    await mockAuthed();
    const { createEventForUser } = await import("@/lib/calendar/write");
    vi.mocked(createEventForUser).mockRejectedValue(
      new CalendarWriteError("Calendar is read-only", 403),
    );

    const { POST } = await import("@/app/api/mobile/calendar/events/route");
    const res = await POST(makeBody(EVENT_BODY));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Calendar is read-only" });
    expect(createEventForUser).toHaveBeenCalledWith(
      "user-1",
      "cal-1",
      expect.objectContaining({
        title: "Standup",
        startAt: new Date("2026-08-20T09:00:00.000Z"),
        endAt: new Date("2026-08-20T09:30:00.000Z"),
      }),
    );
  });

  it("GET /range delegates to listVisibleInstancesForUser", async () => {
    await mockAuthed();
    const { listVisibleInstancesForUser } = await import(
      "@/lib/calendar/query"
    );
    vi.mocked(listVisibleInstancesForUser).mockResolvedValue([
      {
        eventId: "evt-1",
        title: "Standup",
        startAt: new Date("2026-08-20T09:00:00.000Z"),
        endAt: new Date("2026-08-20T09:30:00.000Z"),
        isAllDay: false,
        isCancelled: false,
        isException: false,
        calendarId: "cal-1",
        color: "#b45309",
        calendarName: "Personal",
        transparency: "busy",
        location: null,
        description: null,
        rrule: null,
        isReadOnly: false,
        attendeesJson: null,
      },
    ]);

    const { GET } = await import("@/app/api/mobile/calendar/range/route");
    const res = await GET(
      makeGet({
        start: "2026-08-17T00:00:00.000Z",
        end: "2026-08-24T00:00:00.000Z",
        calendarIds: "cal-1",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.instances).toHaveLength(1);
    expect(body.instances[0]).toMatchObject({
      eventId: "evt-1",
      calendarId: "cal-1",
      title: "Standup",
      startAt: "2026-08-20T09:00:00.000Z",
      isAllDay: false,
    });
    expect(listVisibleInstancesForUser).toHaveBeenCalledWith(
      "user-1",
      new Date("2026-08-17T00:00:00.000Z"),
      new Date("2026-08-24T00:00:00.000Z"),
    );
  });

  it("PATCH /events/:id and DELETE /events/:id pass range through", async () => {
    await mockAuthed();
    const { updateEventForUser, deleteEventForUser } = await import(
      "@/lib/calendar/write"
    );
    vi.mocked(updateEventForUser).mockResolvedValue(undefined);
    vi.mocked(deleteEventForUser).mockResolvedValue(undefined);

    const { PATCH, DELETE } = await import(
      "@/app/api/mobile/calendar/events/[id]/route"
    );

    const patched = await PATCH(
      {
        headers: { get: () => null },
        json: async () => ({ ...EVENT_BODY, range: "this" }),
        nextUrl: { searchParams: new URLSearchParams() },
      } as never,
      params({ id: "evt-1" }),
    );
    expect(patched.status).toBe(200);
    expect(updateEventForUser).toHaveBeenCalledWith(
      "user-1",
      "evt-1",
      expect.objectContaining({ title: "Standup", calendarId: "cal-1" }),
      "this",
      null,
    );

    const deleted = await DELETE(
      {
        headers: { get: () => null },
        nextUrl: { searchParams: new URLSearchParams({ range: "all" }) },
      } as never,
      params({ id: "evt-1" }),
    );
    expect(deleted.status).toBe(200);
    expect(deleteEventForUser).toHaveBeenCalledWith(
      "user-1",
      "evt-1",
      "all",
      null,
    );
  });

  it("DELETE /events/:id forwards a present occurrence query param as a Date", async () => {
    await mockAuthed();
    const { deleteEventForUser } = await import("@/lib/calendar/write");
    vi.mocked(deleteEventForUser).mockResolvedValue(undefined);

    const { DELETE } = await import(
      "@/app/api/mobile/calendar/events/[id]/route"
    );

    const deleted = await DELETE(
      {
        headers: { get: () => null },
        nextUrl: {
          searchParams: new URLSearchParams({
            range: "thisAndFollowing",
            occurrence: "2026-08-21T09:00:00.000Z",
          }),
        },
      } as never,
      params({ id: "evt-1" }),
    );
    expect(deleted.status).toBe(200);
    expect(deleteEventForUser).toHaveBeenCalledWith(
      "user-1",
      "evt-1",
      "thisAndFollowing",
      new Date("2026-08-21T09:00:00.000Z"),
    );
  });

  it("POST /accounts/ics without bearer auth returns 401", async () => {
    await mockUnauthed();
    const { POST } = await import(
      "@/app/api/mobile/calendar/accounts/ics/route"
    );
    const res = await POST(makeBody({ url: "https://example.com/cal.ics" }));
    expect(res.status).toBe(401);
  });

  it("POST /accounts/ics with a bad body returns 400", async () => {
    await mockAuthed();
    const { POST } = await import(
      "@/app/api/mobile/calendar/accounts/ics/route"
    );
    const res = await POST(makeBody({}));
    expect(res.status).toBe(400);
  });

  it("POST /accounts/ics returns the created account id", async () => {
    await mockAuthed();
    const { createIcsAccount } = await import("@/lib/calendar/ics-account");
    vi.mocked(createIcsAccount).mockResolvedValue({ id: "acc-ics" });

    const { POST } = await import(
      "@/app/api/mobile/calendar/accounts/ics/route"
    );
    const res = await POST(
      makeBody({ url: "https://example.com/holidays.ics" }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "acc-ics" });
    expect(createIcsAccount).toHaveBeenCalledWith({
      userId: "user-1",
      url: "https://example.com/holidays.ics",
    });
  });
});
