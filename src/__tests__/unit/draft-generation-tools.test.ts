/**
 * The bounded mailbox tools a panel generation may call. Every executor is
 * scoped to the requesting user, capped, and truncated — a tool loop can
 * never turn into a mailbox dump or reach another user's mail.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildMailboxTools,
  TOOL_READ_MAX_CHARS,
  TOOL_SEARCH_LIMIT,
} from "@/lib/draft-generation/tools";

vi.mock("@/lib/db", () => ({
  db: { message: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/mail/search", () => ({ searchMessages: vi.fn() }));

import { db } from "@/lib/db";
import { searchMessages } from "@/lib/mail/search";

const tools = () => buildMailboxTools("user-1");
const searchTool = () => tools().find((t) => t.name === "search_mail")!;
const readTool = () => tools().find((t) => t.name === "read_message")!;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("search_mail", () => {
  it("searches the requesting user's mail only, capped, in a compact shape", async () => {
    vi.mocked(searchMessages).mockResolvedValue([
      {
        id: "m1",
        subject: "March invoice",
        snippet: "Attached is the invoice",
        fromAddress: "ada@x.y",
        fromName: "Ada",
        toAddresses: [],
        ccAddresses: [],
        receivedAt: new Date("2026-03-04T10:00:00Z"),
        isRead: true,
        hasAttachments: true,
        snoozedUntil: null,
        followUpAt: null,
      },
    ]);

    const out = await searchTool().run({ query: "invoice March" });

    expect(vi.mocked(searchMessages).mock.calls[0][0]).toBe("user-1");
    expect(vi.mocked(searchMessages).mock.calls[0][3]).toBe(TOOL_SEARCH_LIMIT);
    expect(JSON.parse(out)).toEqual([
      {
        id: "m1",
        from: "Ada <ada@x.y>",
        subject: "March invoice",
        date: "2026-03-04",
        snippet: "Attached is the invoice",
      },
    ]);
  });

  it("says so instead of erroring on no hits and on an empty query", async () => {
    vi.mocked(searchMessages).mockResolvedValue([]);
    expect(await searchTool().run({ query: "nothing" })).toBe("No matching mail.");
    expect(await searchTool().run({ query: "  " })).toBe("No query given.");
    expect(await searchTool().run({})).toBe("No query given.");
  });
});

describe("read_message", () => {
  it("reads one of the user's own messages as truncated plain text", async () => {
    vi.mocked(db.message.findFirst).mockResolvedValue({
      subject: "March invoice",
      fromAddress: "ada@x.y",
      fromName: "Ada",
      toAddresses: ["me@own.io"],
      receivedAt: new Date("2026-03-04T10:00:00Z"),
      textBody: "x".repeat(TOOL_READ_MAX_CHARS * 2),
      htmlBody: null,
    } as never);

    const out = await readTool().run({ id: "m1" });

    const where = vi.mocked(db.message.findFirst).mock.calls[0][0]!.where as {
      userId: string;
      id: string;
    };
    expect(where).toEqual({ userId: "user-1", id: "m1" });
    expect(out).toContain("From: Ada <ada@x.y>");
    expect(out).toContain("Subject: March invoice");
    expect(out.length).toBeLessThan(TOOL_READ_MAX_CHARS + 500);
  });

  it("a message the user does not own reads as missing, not as an error", async () => {
    vi.mocked(db.message.findFirst).mockResolvedValue(null as never);
    expect(await readTool().run({ id: "someone-elses" })).toBe("No such message.");
    expect(await readTool().run({})).toBe("No message id given.");
  });
});

describe("the tool set", () => {
  it("offers exactly search_mail and read_message, each with an input schema", () => {
    expect(tools().map((t) => t.name)).toEqual(["search_mail", "read_message"]);
    for (const tool of tools()) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.description).not.toBe("");
    }
  });
});
