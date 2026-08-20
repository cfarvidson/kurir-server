import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  const messageMeeting = {
    upsert: vi.fn(),
  };
  const calendarEvent = {
    findFirst: vi.fn(),
  };
  return {
    db: {
      messageMeeting,
      calendarEvent,
    },
  };
});

import { db } from "@/lib/db";
import { ingestMeetingFromParsed } from "@/lib/calendar/ingest";

function fixture(name: string): string {
  return readFileSync(
    path.join(__dirname, "../fixtures/ics", name),
    "utf8",
  );
}

describe("ingestMeetingFromParsed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.calendarEvent.findFirst).mockResolvedValue(null);
    vi.mocked(db.messageMeeting.upsert).mockResolvedValue({} as never);
  });

  it("upserts MessageMeeting from a text/calendar attachment", async () => {
    const ics = fixture("google-request.ics");
    await ingestMeetingFromParsed("user-1", "msg-1", {
      attachments: [
        {
          contentType: "text/calendar",
          filename: "invite.ics",
          content: Buffer.from(ics, "utf8"),
        },
      ],
    });

    expect(db.messageMeeting.upsert).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(db.messageMeeting.upsert).mock.calls[0][0];
    expect(arg.where).toEqual({ messageId: "msg-1" });
    expect(arg.create).toMatchObject({
      userId: "user-1",
      messageId: "msg-1",
      uid: "g-uid-1@google.com",
      method: "REQUEST",
      title: "Design review",
      location: "Room 4",
      organizerEmail: "ada@x.y",
      organizerName: "Ada",
      isAllDay: false,
      calendarEventId: null,
    });
    expect(arg.create.startAt).toBeInstanceOf(Date);
    expect(arg.create.endAt).toBeInstanceOf(Date);
    expect(arg.update).toMatchObject({
      uid: "g-uid-1@google.com",
      method: "REQUEST",
      title: "Design review",
      calendarEventId: null,
    });
  });

  it("sets calendarEventId when icalUid matches for the user", async () => {
    vi.mocked(db.calendarEvent.findFirst).mockResolvedValue({
      id: "evt-9",
    } as never);

    await ingestMeetingFromParsed("user-1", "msg-2", {
      attachments: [
        {
          contentType: "text/calendar",
          content: Buffer.from(fixture("google-request.ics"), "utf8"),
        },
      ],
    });

    expect(db.calendarEvent.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", icalUid: "g-uid-1@google.com" },
      select: { id: true },
    });
    const arg = vi.mocked(db.messageMeeting.upsert).mock.calls[0][0];
    expect(arg.create.calendarEventId).toBe("evt-9");
    expect(arg.update.calendarEventId).toBe("evt-9");
  });

  it("does not throw on garbage ICS and skips upsert", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        ingestMeetingFromParsed("user-1", "msg-3", {
          attachments: [
            {
              contentType: "text/calendar",
              content: Buffer.from(fixture("garbage.ics"), "utf8"),
            },
          ],
        }),
      ).resolves.toBeUndefined();

      expect(db.messageMeeting.upsert).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      const logged = warnSpy.mock.calls
        .map((c) => c.map(String).join(" "))
        .join("\n");
      expect(logged).toContain("[calendar-ics] skip");
      expect(logged).not.toContain("not ics at all");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not throw when attachments are missing", async () => {
    await expect(
      ingestMeetingFromParsed("user-1", "msg-4", {}),
    ).resolves.toBeUndefined();
    expect(db.messageMeeting.upsert).not.toHaveBeenCalled();
  });
});
