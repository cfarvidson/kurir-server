import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mail/send", () => ({
  sendMailForUser: vi.fn(),
}));

vi.mock("@/lib/demo", () => ({
  isDemoInstance: vi.fn(() => false),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  canManageConnections: vi.fn().mockResolvedValue(true),
  getConnectionCredentials: vi.fn(),
  getDefaultConnectionCredentials: vi.fn(),
}));

vi.mock("@/lib/mail/messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mail/messages")>();
  return { ...actual, getMessages: vi.fn() };
});

vi.mock("@/lib/mail/threads", () => ({ getThreadMessages: vi.fn() }));
vi.mock("@/lib/mail/search", () => ({ searchMessages: vi.fn() }));
vi.mock("@/lib/mail/sidebar-counts", () => ({ getSidebarCounts: vi.fn() }));
vi.mock("@/lib/mail/files", () => ({ getFiles: vi.fn() }));
vi.mock("@/lib/mail/drafts", () => ({
  listDraftsForUser: vi.fn(),
  saveDraftForUser: vi.fn(),
  deleteDraftForUser: vi.fn(),
}));
vi.mock("@/lib/mail/mutations", () => ({
  archiveThread: vi.fn(),
  unarchiveThread: vi.fn(),
  setThreadReadState: vi.fn(),
  snoozeThread: vi.fn(),
  unsnoozeThread: vi.fn(),
  setThreadFollowUp: vi.fn(),
  dismissThreadFollowUp: vi.fn(),
  setThreadReplyLater: vi.fn(),
  approveSenderForUser: vi.fn(),
  skipSenderForUser: vi.fn(),
  unskipSenderForUser: vi.fn(),
  undoScreenActionForUser: vi.fn(),
  rejectSenderForUser: vi.fn(),
  changeSenderCategoryForUser: vi.fn(),
  setSenderUnthreadForUser: vi.fn(),
  setSenderAllowImagesForUser: vi.fn(),
  createDomainRuleForUser: vi.fn(),
  changeDomainRuleCategoryForUser: vi.fn(),
  deleteDomainRuleForUser: vi.fn(),
  listDomainRulesForUser: vi.fn(),
  bulkApproveOldSendersForUser: vi.fn(),
}));
vi.mock("@/lib/mail/scheduled-messages", () => ({
  updateScheduledForUser: vi.fn(),
  cancelScheduledForUser: vi.fn(),
  createScheduledMessageForUser: vi.fn(),
  sendScheduledNowForUser: vi.fn(),
  insertScheduledMessageForUser: vi.fn(),
  deliverScheduledNowForUser: vi.fn(),
}));
vi.mock("@/lib/mail/contacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mail/contacts")>();
  return {
    ...actual,
    getContactForUser: vi.fn(),
    deleteContactForUser: vi.fn(),
  };
});
vi.mock("@/lib/mail/contact-groups", () => ({
  addGroupMemberForUser: vi.fn(),
  createGroupForUser: vi.fn(),
  listGroupsForUser: vi.fn(),
  removeGroupMemberForUser: vi.fn(),
  renameGroupForUser: vi.fn(),
  setGroupDefaultTargetForUser: vi.fn(),
  deleteGroupForUser: vi.fn(),
}));
vi.mock("@/lib/mail/user-emails", () => ({
  getOwnAddresses: vi.fn().mockResolvedValue({ emails: [], domains: [] }),
  isOwnAddress: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitUploads: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 30, retryAfter: 0 }),
  rateLimitSync: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 1, retryAfter: 0 }),
  rateLimitSend: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 30, retryAfter: 0 }),
}));
vi.mock("@/lib/jobs/queue", () => ({
  getSyncQueue: vi.fn(() => ({ add: vi.fn() })),
}));
vi.mock("@/lib/jobs/maintenance-tasks", () => ({
  approveOwnPendingSenders: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/db", () => ({
  db: {
    message: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    sender: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    scheduledMessage: { findMany: vi.fn(), findFirst: vi.fn() },
    attachment: {
      findUnique: vi.fn(),
      create: vi.fn(),
      aggregate: vi.fn(),
    },
    emailConnection: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn(), update: vi.fn() },
    messageMeeting: { findFirst: vi.fn() },
    passkey: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    mcpConfirmation: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    contact: { findMany: vi.fn(), findFirst: vi.fn() },
    contactGroup: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/calendar/query", () => ({
  listVisibleInstancesForUser: vi.fn(),
}));
vi.mock("@/lib/calendar/write", () => ({
  getEventForUser: vi.fn(),
  createEventForUser: vi.fn(),
  deleteEventForUser: vi.fn(),
}));
vi.mock("@/lib/calendar/rsvp", () => ({
  rsvpToMeetingForUser: vi.fn(),
}));

import { listVisibleInstancesForUser } from "@/lib/calendar/query";
import {
  createEventForUser,
  deleteEventForUser,
  getEventForUser,
} from "@/lib/calendar/write";
import { rsvpToMeetingForUser } from "@/lib/calendar/rsvp";
import { isDemoInstance } from "@/lib/demo";
import { hashArgs } from "@/lib/mcp/canonical-json";
import { db } from "@/lib/db";
import { getTool } from "@/lib/mcp/tools";
import type { ToolContext } from "@/lib/mcp/types";

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: "u1",
    tokenId: "t1",
    hasElicitation: true,
    ...overrides,
  };
}

function acceptCtx(): ToolContext {
  return ctx({
    requestState: "conf-1",
    inputResponses: { confirm: { action: "accept" } },
  });
}

async function call(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext = ctx(),
) {
  const tool = getTool(name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return tool.handler(context, args);
}

function mockPendingConfirmation(toolName: string, args: unknown) {
  vi.mocked(db.mcpConfirmation.findUnique).mockResolvedValue({
    userId: "u1",
    tokenId: "t1",
    toolName,
    argsHash: hashArgs(args),
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  } as never);
  vi.mocked(db.mcpConfirmation.updateMany).mockResolvedValue({ count: 1 });
}

const instance = {
  eventId: "ev-1",
  calendarId: "cal-1",
  title: "Standup",
  startAt: new Date("2026-09-15T07:00:00.000Z"),
  endAt: new Date("2026-09-15T07:15:00.000Z"),
  isAllDay: false,
  isCancelled: false,
  isException: false,
  color: "#123456",
  calendarName: "Work",
  transparency: "busy" as const,
  location: "Room 1",
  description: null,
  rrule: null,
  isReadOnly: false,
  attendeesJson: [{ email: "a@b.com", name: "A", status: "accepted" }],
};

describe("MCP calendar tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDemoInstance).mockReturnValue(false);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      timezone: "Europe/Stockholm",
    } as never);
    vi.mocked(db.mcpConfirmation.create).mockResolvedValue({} as never);
    vi.mocked(listVisibleInstancesForUser).mockResolvedValue([
      instance,
      { ...instance, eventId: "ev-2", calendarId: "cal-2", title: "Lunch" },
    ]);
  });

  describe("list_events", () => {
    it("passes the window to the core and returns compact rows", async () => {
      const result = await call("list_events", {
        start: "2026-09-15T00:00:00Z",
        end: "2026-09-16T00:00:00Z",
      });
      expect(listVisibleInstancesForUser).toHaveBeenCalledWith(
        "u1",
        new Date("2026-09-15T00:00:00.000Z"),
        new Date("2026-09-16T00:00:00.000Z"),
      );
      expect(result).toMatchObject({
        type: "ok",
        structuredContent: {
          events: [
            {
              eventId: "ev-1",
              calendarId: "cal-1",
              calendarName: "Work",
              title: "Standup",
              startAt: "2026-09-15T07:00:00.000Z",
              endAt: "2026-09-15T07:15:00.000Z",
              isAllDay: false,
              location: "Room 1",
              attendees: [{ email: "a@b.com" }],
            },
            { eventId: "ev-2", title: "Lunch" },
          ],
        },
      });
    });

    it("filters by calendarId when given", async () => {
      const result = await call("list_events", {
        start: "2026-09-15T00:00:00Z",
        end: "2026-09-16T00:00:00Z",
        calendarId: "cal-2",
      });
      expect(result).toMatchObject({
        type: "ok",
        structuredContent: { events: [{ eventId: "ev-2" }] },
      });
      if (result.type === "ok") {
        const content = result.structuredContent as { events: unknown[] };
        expect(content.events).toHaveLength(1);
      }
    });

    it("reads a naive datetime in the user's timezone", async () => {
      await call("list_events", {
        start: "2026-09-15T09:00",
        end: "2026-09-15T17:00",
      });
      expect(listVisibleInstancesForUser).toHaveBeenCalledWith(
        "u1",
        new Date("2026-09-15T07:00:00.000Z"),
        new Date("2026-09-15T15:00:00.000Z"),
      );
    });

    it("rejects a window that does not move forward", async () => {
      const result = await call("list_events", {
        start: "2026-09-16T00:00:00Z",
        end: "2026-09-15T00:00:00Z",
      });
      expect(result).toMatchObject({ type: "error" });
      expect(listVisibleInstancesForUser).not.toHaveBeenCalled();
    });
  });

  describe("get_event", () => {
    const loaded = {
      id: "ev-1",
      calendarId: "cal-1",
      title: "Standup",
      startAt: new Date("2026-09-15T07:00:00.000Z"),
      endAt: new Date("2026-09-15T07:15:00.000Z"),
      isAllDay: false,
      timezone: "Europe/Stockholm",
      rrule: "FREQ=DAILY",
      location: "Room 1",
      description: "Daily sync",
      status: "confirmed",
      transparency: "busy",
      organizerJson: { email: "boss@b.com", name: "Boss" },
      attendeesJson: [{ email: "a@b.com", name: "A", status: "accepted" }],
      masterEventId: null,
      recurrenceId: null,
      calendar: {
        id: "cal-1",
        name: "Work",
        isReadOnly: false,
        account: { id: "acc-1", oauthAccessToken: "super-secret-token" },
      },
      exceptions: [],
      instances: [],
    };

    it("returns the event fields without account credentials", async () => {
      vi.mocked(getEventForUser).mockResolvedValue(loaded as never);
      const result = await call("get_event", { id: "ev-1" });
      expect(getEventForUser).toHaveBeenCalledWith("u1", "ev-1");
      expect(result).toMatchObject({
        type: "ok",
        structuredContent: {
          id: "ev-1",
          calendarId: "cal-1",
          calendarName: "Work",
          title: "Standup",
          startAt: "2026-09-15T07:00:00.000Z",
          endAt: "2026-09-15T07:15:00.000Z",
          isAllDay: false,
          timezone: "Europe/Stockholm",
          rrule: "FREQ=DAILY",
          location: "Room 1",
          description: "Daily sync",
          status: "confirmed",
          isReadOnly: false,
          organizer: { email: "boss@b.com" },
          attendees: [{ email: "a@b.com" }],
        },
      });
      expect(JSON.stringify(result)).not.toContain("super-secret-token");
    });

    it("maps a missing event to not found or not yours", async () => {
      vi.mocked(getEventForUser).mockRejectedValue(
        new Error("Event not found"),
      );
      const result = await call("get_event", { id: "nope" });
      expect(result).toEqual({ type: "error", message: "not found or not yours" });
    });
  });

  describe("create_event", () => {
    const createArgs = {
      calendarId: "cal-1",
      title: "Dentist",
      start: "2026-09-20T09:00",
      end: "2026-09-20T09:30",
      allDay: false,
      location: "Downtown",
      notes: "Bring card",
    };

    beforeEach(() => {
      vi.mocked(createEventForUser).mockResolvedValue({ id: "ev-new" });
    });

    it("without elicitation does not create", async () => {
      const result = await call(
        "create_event",
        createArgs,
        ctx({ hasElicitation: false }),
      );
      expect(result).toEqual({
        type: "error",
        message: "this client cannot confirm this action",
      });
      expect(createEventForUser).not.toHaveBeenCalled();
      expect(db.mcpConfirmation.create).not.toHaveBeenCalled();
    });

    it("first call returns input_required with a summary", async () => {
      const result = await call("create_event", createArgs);
      expect(result).toMatchObject({ type: "input_required" });
      if (result.type === "input_required") {
        expect(result.requestState).toEqual(expect.any(String));
        expect(result.message).toMatch(/Dentist/);
        expect(result.message).toMatch(/cal-1/);
        expect(result.message).toMatch(/2026-09-20T07:00:00.000Z/);
      }
      expect(createEventForUser).not.toHaveBeenCalled();
      expect(db.mcpConfirmation.create).toHaveBeenCalled();
    });

    it("accept with matching args creates once in the user's timezone", async () => {
      mockPendingConfirmation("create_event", createArgs);
      const result = await call("create_event", createArgs, acceptCtx());
      expect(result).toEqual({
        type: "ok",
        structuredContent: { id: "ev-new" },
      });
      expect(createEventForUser).toHaveBeenCalledTimes(1);
      expect(createEventForUser).toHaveBeenCalledWith("u1", "cal-1", {
        title: "Dentist",
        description: "Bring card",
        location: "Downtown",
        startAt: new Date("2026-09-20T07:00:00.000Z"),
        endAt: new Date("2026-09-20T07:30:00.000Z"),
        isAllDay: false,
        timezone: "Europe/Stockholm",
        rrule: null,
      });
    });

    it("all-day uses civil dates with an inclusive end day", async () => {
      const args = {
        calendarId: "cal-1",
        title: "Offsite",
        start: "2026-09-20",
        end: "2026-09-21",
        allDay: true,
      };
      mockPendingConfirmation("create_event", args);
      const result = await call("create_event", args, acceptCtx());
      expect(result.type).toBe("ok");
      expect(createEventForUser).toHaveBeenCalledWith(
        "u1",
        "cal-1",
        expect.objectContaining({
          startAt: new Date("2026-09-20T00:00:00.000Z"),
          endAt: new Date("2026-09-22T00:00:00.000Z"),
          isAllDay: true,
          timezone: null,
          description: null,
          location: null,
        }),
      );
    });

    it("accept with a swapped start does not create", async () => {
      mockPendingConfirmation("create_event", createArgs);
      const result = await call(
        "create_event",
        { ...createArgs, start: "2026-09-20T08:00" },
        acceptCtx(),
      );
      expect(result).toEqual({
        type: "error",
        message: "confirmation does not match arguments",
      });
      expect(createEventForUser).not.toHaveBeenCalled();
    });

    it("rejects end before start without creating a confirmation", async () => {
      const result = await call("create_event", {
        ...createArgs,
        end: "2026-09-20T08:00",
      });
      expect(result).toMatchObject({ type: "error" });
      expect(db.mcpConfirmation.create).not.toHaveBeenCalled();
    });

    it("on a demo instance errors without creating a confirmation", async () => {
      vi.mocked(isDemoInstance).mockReturnValue(true);
      const result = await call("create_event", createArgs);
      expect(result).toEqual({
        type: "error",
        message: "Calendar changes are disabled on this demo instance.",
      });
      expect(createEventForUser).not.toHaveBeenCalled();
      expect(db.mcpConfirmation.create).not.toHaveBeenCalled();
    });
  });

  describe("delete_event", () => {
    beforeEach(() => {
      vi.mocked(getEventForUser).mockResolvedValue({
        id: "ev-1",
        calendarId: "cal-1",
        title: "Standup",
        startAt: new Date("2026-09-15T07:00:00.000Z"),
        endAt: new Date("2026-09-15T07:15:00.000Z"),
        isAllDay: false,
        rrule: "FREQ=DAILY",
        calendar: { id: "cal-1", name: "Work", isReadOnly: false },
      } as never);
      vi.mocked(deleteEventForUser).mockResolvedValue(undefined);
    });

    it("first call returns input_required naming the event", async () => {
      const result = await call("delete_event", { id: "ev-1" });
      expect(result).toMatchObject({ type: "input_required" });
      if (result.type === "input_required") {
        expect(result.message).toMatch(/Standup/);
        expect(result.message).toMatch(/all/);
      }
      expect(deleteEventForUser).not.toHaveBeenCalled();
    });

    it("accept deletes the whole series by default", async () => {
      const args = { id: "ev-1" };
      mockPendingConfirmation("delete_event", { id: "ev-1", range: "all" });
      const result = await call("delete_event", args, acceptCtx());
      expect(result).toEqual({
        type: "ok",
        structuredContent: { ok: true, id: "ev-1" },
      });
      expect(deleteEventForUser).toHaveBeenCalledTimes(1);
      expect(deleteEventForUser).toHaveBeenCalledWith(
        "u1",
        "ev-1",
        "all",
        null,
      );
    });

    it("accept with range this passes the occurrence", async () => {
      const args = {
        id: "ev-1",
        range: "this",
        occurrence: "2026-09-16T07:00:00.000Z",
      };
      mockPendingConfirmation("delete_event", args);
      const result = await call("delete_event", args, acceptCtx());
      expect(result.type).toBe("ok");
      expect(deleteEventForUser).toHaveBeenCalledWith(
        "u1",
        "ev-1",
        "this",
        new Date("2026-09-16T07:00:00.000Z"),
      );
    });

    it("range this without an occurrence is rejected before confirmation", async () => {
      const result = await call("delete_event", { id: "ev-1", range: "this" });
      expect(result).toMatchObject({ type: "error" });
      expect(db.mcpConfirmation.create).not.toHaveBeenCalled();
      expect(deleteEventForUser).not.toHaveBeenCalled();
    });

    it("accept with a swapped id does not delete", async () => {
      mockPendingConfirmation("delete_event", { id: "ev-1", range: "all" });
      const result = await call("delete_event", { id: "ev-2" }, acceptCtx());
      expect(result).toEqual({
        type: "error",
        message: "confirmation does not match arguments",
      });
      expect(deleteEventForUser).not.toHaveBeenCalled();
    });

    it("unknown event maps to not found or not yours", async () => {
      vi.mocked(getEventForUser).mockRejectedValue(
        new Error("Event not found"),
      );
      const result = await call("delete_event", { id: "nope" });
      expect(result).toEqual({ type: "error", message: "not found or not yours" });
      expect(db.mcpConfirmation.create).not.toHaveBeenCalled();
    });

    it("on a demo instance errors without creating a confirmation", async () => {
      vi.mocked(isDemoInstance).mockReturnValue(true);
      const result = await call("delete_event", { id: "ev-1" });
      expect(result).toEqual({
        type: "error",
        message: "Calendar changes are disabled on this demo instance.",
      });
      expect(deleteEventForUser).not.toHaveBeenCalled();
      expect(db.mcpConfirmation.create).not.toHaveBeenCalled();
    });
  });

  describe("respond_to_event", () => {
    const rsvpArgs = { messageId: "m1", status: "accepted" };

    beforeEach(() => {
      vi.mocked(db.messageMeeting.findFirst).mockResolvedValue({
        title: "Planning",
        startAt: new Date("2026-09-17T08:00:00.000Z"),
        organizerEmail: "boss@b.com",
      } as never);
      vi.mocked(rsvpToMeetingForUser).mockResolvedValue(undefined);
    });

    it("first call returns input_required naming the meeting", async () => {
      const result = await call("respond_to_event", rsvpArgs);
      expect(db.messageMeeting.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "u1", messageId: "m1" },
        }),
      );
      expect(result).toMatchObject({ type: "input_required" });
      if (result.type === "input_required") {
        expect(result.message).toMatch(/Planning/);
        expect(result.message).toMatch(/accepted/);
      }
      expect(rsvpToMeetingForUser).not.toHaveBeenCalled();
    });

    it("accept responds once through the core", async () => {
      mockPendingConfirmation("respond_to_event", rsvpArgs);
      const result = await call("respond_to_event", rsvpArgs, acceptCtx());
      expect(result).toEqual({
        type: "ok",
        structuredContent: { ok: true, messageId: "m1", status: "accepted" },
      });
      expect(rsvpToMeetingForUser).toHaveBeenCalledTimes(1);
      expect(rsvpToMeetingForUser).toHaveBeenCalledWith(
        "u1",
        "m1",
        "accepted",
        undefined,
      );
    });

    it("passes calendarId through when given", async () => {
      const args = { ...rsvpArgs, status: "declined", calendarId: "cal-2" };
      mockPendingConfirmation("respond_to_event", args);
      await call("respond_to_event", args, acceptCtx());
      expect(rsvpToMeetingForUser).toHaveBeenCalledWith(
        "u1",
        "m1",
        "declined",
        "cal-2",
      );
    });

    it("accept with a swapped status does not respond", async () => {
      mockPendingConfirmation("respond_to_event", rsvpArgs);
      const result = await call(
        "respond_to_event",
        { ...rsvpArgs, status: "declined" },
        acceptCtx(),
      );
      expect(result).toEqual({
        type: "error",
        message: "confirmation does not match arguments",
      });
      expect(rsvpToMeetingForUser).not.toHaveBeenCalled();
    });

    it("unknown meeting maps to not found or not yours", async () => {
      vi.mocked(db.messageMeeting.findFirst).mockResolvedValue(null);
      const result = await call("respond_to_event", rsvpArgs);
      expect(result).toEqual({ type: "error", message: "not found or not yours" });
      expect(db.mcpConfirmation.create).not.toHaveBeenCalled();
    });

    it("rejects an unknown status", async () => {
      const result = await call("respond_to_event", {
        ...rsvpArgs,
        status: "maybe",
      });
      expect(result).toMatchObject({ type: "error" });
      expect(db.mcpConfirmation.create).not.toHaveBeenCalled();
    });

    it("on a demo instance errors without creating a confirmation", async () => {
      vi.mocked(isDemoInstance).mockReturnValue(true);
      const result = await call("respond_to_event", rsvpArgs);
      expect(result).toEqual({
        type: "error",
        message: "Calendar changes are disabled on this demo instance.",
      });
      expect(rsvpToMeetingForUser).not.toHaveBeenCalled();
      expect(db.mcpConfirmation.create).not.toHaveBeenCalled();
    });
  });
});
