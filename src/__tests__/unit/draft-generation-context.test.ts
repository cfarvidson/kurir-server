/**
 * Context pack for draft generation: correspondent resolution, body
 * reduction (quote-strip, HTML-to-text, truncation), and the capped replica
 * queries (8 from the correspondent + 5 own-sent, current message excluded).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CONTEXT_BODY_MAX_CHARS,
  CONTEXT_FROM_SENDER_CAP,
  CONTEXT_OWN_SENT_CAP,
  buildContextPack,
  contextBodyText,
  firstToAddress,
  resolveReplyAddresses,
} from "@/lib/draft-generation/context";
import type { OwnAddresses } from "@/lib/mail/user-emails";

vi.mock("@/lib/db", () => ({
  db: {
    message: { findMany: vi.fn() },
  },
}));

import { db } from "@/lib/db";

const own: OwnAddresses = { emails: ["me@own.io"], domains: [] };

describe("contextBodyText", () => {
  it("prefers textBody and strips the trailing quoted tail with its attribution line", () => {
    const text = contextBodyText({
      textBody:
        "Yes, Thursday works.\n\nOn Mon, Ada wrote:\n> Does Thursday work?\n> /Ada",
      htmlBody: null,
    });
    expect(text).toBe("Yes, Thursday works.");
  });

  it("reduces HTML to readable text with no tags or attributes", () => {
    const text = contextBodyText({
      textBody: null,
      htmlBody:
        '<div style="x"><p>Hello <b>there</b></p><img src="https://t.example/pixel?u=1"><script>evil()</script></div>',
    });
    expect(text).toBe("Hello there");
    expect(text).not.toContain("<");
    expect(text).not.toContain("pixel");
  });

  it("truncates a single long body", () => {
    const text = contextBodyText({ textBody: "x".repeat(5000), htmlBody: null });
    expect(text).toHaveLength(CONTEXT_BODY_MAX_CHARS);
  });

  it("is empty when the message has no bodies", () => {
    expect(contextBodyText({ textBody: null, htmlBody: null })).toBe("");
  });
});

describe("resolveReplyAddresses", () => {
  it("uses the non-own fromAddress as correspondent and Reply-To as the draft target", () => {
    expect(
      resolveReplyAddresses(
        {
          fromAddress: "ada@x.y",
          replyTo: "list-reply@x.y",
          toAddresses: ["me@own.io"],
        },
        own,
      ),
    ).toEqual({ correspondent: "ada@x.y", to: "list-reply@x.y" });
  });

  it("falls back to fromAddress when there is no Reply-To", () => {
    expect(
      resolveReplyAddresses(
        { fromAddress: "ada@x.y", replyTo: null, toAddresses: ["me@own.io"] },
        own,
      ),
    ).toEqual({ correspondent: "ada@x.y", to: "ada@x.y" });
  });

  it("own-address from is not the correspondent — replying to own sent mail targets the recipient", () => {
    expect(
      resolveReplyAddresses(
        {
          fromAddress: "me@own.io",
          replyTo: null,
          toAddresses: ["me@own.io", "ada@x.y"],
        },
        own,
      ),
    ).toEqual({ correspondent: "ada@x.y", to: "ada@x.y" });
  });

  it("returns null when every address on the mail is the user's", () => {
    expect(
      resolveReplyAddresses(
        { fromAddress: "me@own.io", replyTo: null, toAddresses: ["me@own.io"] },
        own,
      ),
    ).toBeNull();
  });
});

describe("firstToAddress", () => {
  it("takes the first address of a comma or semicolon list", () => {
    expect(firstToAddress("ada@x.y, bob@x.y")).toBe("ada@x.y");
    expect(firstToAddress(" ; ada@x.y")).toBe("ada@x.y");
  });

  it("is null for an empty To", () => {
    expect(firstToAddress("")).toBeNull();
    expect(firstToAddress(undefined)).toBeNull();
  });
});

describe("buildContextPack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const currentMessage = {
    id: "msg-current",
    subject: "Latest",
    fromAddress: "Ada@x.y",
    fromName: "Ada",
    receivedAt: new Date("2026-08-10T10:00:00Z"),
    textBody: "The newest mail",
    htmlBody: null,
  };

  it("queries capped, strictly earlier correspondent mail and own-sent mail", async () => {
    vi.mocked(db.message.findMany).mockImplementation(((args: {
      where: { OR?: unknown };
    }) =>
      Promise.resolve(
        args.where.OR
          ? [
              {
                subject: "My earlier answer",
                receivedAt: new Date("2026-08-01T10:00:00Z"),
                textBody: "I said hello before",
                htmlBody: null,
                // Stored mixed-case recipient still matches the correspondent.
                toAddresses: ["ADA@X.Y"],
              },
              {
                subject: "To someone else",
                receivedAt: new Date("2026-07-30T10:00:00Z"),
                textBody: "Unrelated sent mail",
                htmlBody: null,
                toAddresses: ["bob@x.y"],
              },
            ]
          : [
              {
                subject: "Earlier from Ada",
                receivedAt: new Date("2026-08-02T10:00:00Z"),
                textBody: "Prior mail from the sender",
                htmlBody: null,
              },
            ],
      )) as never);

    const pack = await buildContextPack("user-1", "Ada@x.y", own, currentMessage);

    const calls = vi.mocked(db.message.findMany).mock.calls.map(
      (c) => c[0] as { where: Record<string, unknown>; take: number },
    );
    const fromCall = calls.find((c) => "fromAddress" in c.where)!;
    const sentCall = calls.find((c) => "OR" in c.where)!;

    expect(fromCall.take).toBe(CONTEXT_FROM_SENDER_CAP);
    expect(fromCall.where.fromAddress).toEqual({
      equals: "Ada@x.y",
      mode: "insensitive",
    });
    expect(fromCall.where.id).toEqual({ not: "msg-current" });
    // "Earlier" is literal — replying to an old mail must not pull newer
    // thread mail into the prompt as "earlier".
    expect(fromCall.where.receivedAt).toEqual({
      lt: currentMessage.receivedAt,
    });

    expect(sentCall.where.id).toEqual({ not: "msg-current" });
    expect(sentCall.where.receivedAt).toEqual({
      lt: currentMessage.receivedAt,
    });

    expect(pack.current).toEqual({
      subject: "Latest",
      from: "Ada <Ada@x.y>",
      body: "The newest mail",
    });
    expect(pack.fromCorrespondent).toEqual([
      {
        subject: "Earlier from Ada",
        date: "2026-08-02",
        body: "Prior mail from the sender",
      },
    ]);
    // Case-insensitive recipient match in; other recipients out; cap 5.
    expect(pack.ownSent).toEqual([
      {
        subject: "My earlier answer",
        date: "2026-08-01",
        body: "I said hello before",
      },
    ]);
  });

  it("caps own-sent mail after the recipient filter", async () => {
    vi.mocked(db.message.findMany).mockImplementation(((args: {
      where: { OR?: unknown };
    }) =>
      Promise.resolve(
        args.where.OR
          ? Array.from({ length: 9 }, (_, i) => ({
              subject: `Sent ${i}`,
              receivedAt: new Date(2026, 0, 9 - i),
              textBody: `body ${i}`,
              htmlBody: null,
              toAddresses: ["ada@x.y"],
            }))
          : [],
      )) as never);
    const pack = await buildContextPack("user-1", "ada@x.y", own, null);
    expect(pack.ownSent).toHaveLength(CONTEXT_OWN_SENT_CAP);
  });

  it("builds a pack from the current message alone when there is no prior mail", async () => {
    vi.mocked(db.message.findMany).mockResolvedValue([] as never);
    const pack = await buildContextPack("user-1", "new@x.y", own, {
      id: "m1",
      subject: "First contact",
      fromAddress: "new@x.y",
      fromName: null,
      receivedAt: new Date("2026-08-10T10:00:00Z"),
      textBody: "Hi!",
      htmlBody: null,
    });
    expect(pack.current?.from).toBe("new@x.y");
    expect(pack.fromCorrespondent).toEqual([]);
    expect(pack.ownSent).toEqual([]);
  });
});
