import { describe, it, expect } from "vitest";
import {
  serializeMailRow,
  serializeThreadMessage,
  plainTextFromBodies,
} from "@/lib/mcp/serialize";

const receivedAt = new Date("2026-08-14T12:00:00.000Z");

function messageFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    threadId: "th1",
    fromAddress: "ada@example.com",
    fromName: "Ada",
    toAddresses: ["bob@example.com"],
    subject: "Hello",
    receivedAt,
    snippet: "Hi there",
    isRead: false,
    isInImbox: true,
    isInFeed: false,
    isInPaperTrail: false,
    isArchived: false,
    isInScreener: false,
    htmlBody: "<p>secret html</p>",
    textBody: "plain body",
    ...overrides,
  };
}

describe("serializeMailRow", () => {
  it("returns a compact row without htmlBody", () => {
    const row = serializeMailRow(messageFixture());
    expect(row).toMatchObject({
      id: "m1",
      threadId: "th1",
      from: "Ada <ada@example.com>",
      to: ["bob@example.com"],
      subject: "Hello",
      date: "2026-08-14T12:00:00.000Z",
      snippet: "Hi there",
      isRead: false,
      isInImbox: true,
      isInFeed: false,
      isInPaperTrail: false,
      isArchived: false,
      isInScreener: false,
    });
    expect(row).not.toHaveProperty("htmlBody");
    expect(row).not.toHaveProperty("textBody");
    expect(JSON.stringify(row)).not.toContain("secret html");
  });

  it("formats from as the address when no name is present", () => {
    const row = serializeMailRow(
      messageFixture({ fromName: null, fromAddress: "solo@example.com" }),
    );
    expect(row.from).toBe("solo@example.com");
  });

  it("includes view-specific flags when present", () => {
    const row = serializeMailRow(
      messageFixture({
        snoozedUntil: new Date("2026-08-20T00:00:00.000Z"),
        followUpAt: new Date("2026-08-21T00:00:00.000Z"),
        isReplyLater: true,
      }),
    );
    expect(row.snoozedUntil).toBe("2026-08-20T00:00:00.000Z");
    expect(row.followUpUntil).toBe("2026-08-21T00:00:00.000Z");
    expect(row.replyLater).toBe(true);
  });
});

describe("plainTextFromBodies", () => {
  it("prefers the existing text body", () => {
    expect(
      plainTextFromBodies({
        textBody: "plain",
        htmlBody: "<p>html</p>",
      }),
    ).toBe("plain");
  });

  it("strips HTML when no text body is present", () => {
    expect(
      plainTextFromBodies({
        textBody: null,
        htmlBody: "<p>Hi <b>Ada</b></p>",
      }),
    ).toBe("Hi Ada");
  });
});

describe("serializeThreadMessage", () => {
  it("returns chronological fields, plain text, and attachment meta", () => {
    const row = serializeThreadMessage({
      ...messageFixture(),
      ccAddresses: ["cc@example.com"],
      attachments: [
        {
          id: "a1",
          filename: "note.txt",
          contentType: "text/plain",
          size: 12,
        },
      ],
    });
    expect(row).toMatchObject({
      id: "m1",
      from: "Ada <ada@example.com>",
      to: ["bob@example.com"],
      cc: ["cc@example.com"],
      date: "2026-08-14T12:00:00.000Z",
      subject: "Hello",
      text: "plain body",
      attachments: [
        {
          id: "a1",
          filename: "note.txt",
          contentType: "text/plain",
          size: 12,
        },
      ],
    });
    expect(row).not.toHaveProperty("htmlBody");
  });
});
