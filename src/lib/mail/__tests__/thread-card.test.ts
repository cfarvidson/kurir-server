import { describe, it, expect } from "vitest";
import {
  answeredMessageIds,
  cardLabel,
  defaultReplyTargetId,
  replyOptionsFor,
  type ThreadCardMessage,
} from "@/lib/mail/thread-card";

const ME = "me@mine.example";
const isOwn = (a: string) => a.trim().toLowerCase() === ME;
const names: Record<string, string> = {
  "anna@corp-a.example": "Anna",
  "bo@corp-b.example": "Bo",
};
const nameFor = (a: string) => names[a.trim().toLowerCase()] ?? a;

function msg(partial: Partial<ThreadCardMessage> & { id: string }): ThreadCardMessage {
  return {
    subject: "Offer",
    fromAddress: "anna@corp-a.example",
    fromName: "Anna L",
    toAddresses: [ME],
    ccAddresses: [],
    ...partial,
  };
}

describe("replyOptionsFor", () => {
  it("replies to Reply-To/From for an incoming card and adds the other externals on reply-all", () => {
    const o = replyOptionsFor(
      msg({
        id: "a1",
        messageId: "<a1@x>",
        references: ["<m0@x>"],
        replyTo: "sales@corp-a.example",
        toAddresses: [ME, "bo@corp-b.example", "Sales@corp-a.example"],
        ccAddresses: ["cc@corp-a.example", ME],
        sender: { displayName: "Corp A" },
      }),
      isOwn,
      nameFor,
    );
    expect(o).toEqual({
      messageId: "a1",
      replyToAddress: "sales@corp-a.example",
      replyToName: "Corp A",
      replyAllExtraTo: ["bo@corp-b.example"],
      replyAllCc: ["cc@corp-a.example"],
      subject: "Offer",
      rfcMessageId: "<a1@x>",
      references: ["<m0@x>"],
    });
  });

  it("replies to the first external recipient of an own card", () => {
    const o = replyOptionsFor(
      msg({
        id: "s1",
        fromAddress: ME,
        toAddresses: [ME, "anna@corp-a.example", "bo@corp-b.example"],
        ccAddresses: ["cc@corp-a.example"],
      }),
      isOwn,
      nameFor,
    );
    expect(o.replyToAddress).toBe("anna@corp-a.example");
    expect(o.replyToName).toBe("Anna");
    expect(o.replyAllExtraTo).toEqual(["bo@corp-b.example"]);
    expect(o.replyAllCc).toEqual(["cc@corp-a.example"]);
  });

  it("falls back to the first To address for a bcc-only own card", () => {
    const o = replyOptionsFor(
      msg({ id: "m0", fromAddress: ME, toAddresses: [ME], subject: null }),
      isOwn,
      nameFor,
    );
    expect(o.replyToAddress).toBe(ME);
    expect(o.subject).toBe("(no subject)");
    expect(o.replyAllExtraTo).toEqual([]);
  });
});

describe("cardLabel", () => {
  it("names the counterpart on incoming cards", () => {
    expect(cardLabel(msg({ id: "a" }), isOwn, nameFor)).toBe("Anna L");
    expect(
      cardLabel(msg({ id: "a", sender: { displayName: "Corp A" } }), isOwn, nameFor),
    ).toBe("Corp A");
  });

  it("shows where an own card went", () => {
    expect(
      cardLabel(
        msg({ id: "s", fromAddress: ME, toAddresses: ["anna@corp-a.example"] }),
        isOwn,
        nameFor,
      ),
    ).toBe("You → Anna");
    expect(
      cardLabel(
        msg({
          id: "s",
          fromAddress: ME,
          toAddresses: ["anna@corp-a.example", ME],
          ccAddresses: ["bo@corp-b.example", "x@y.example"],
        }),
        isOwn,
        nameFor,
      ),
    ).toBe("You → Anna +2");
  });

  it("counts bcc recipients for a broadcast and falls back to You", () => {
    expect(
      cardLabel(
        msg({
          id: "m0",
          fromAddress: ME,
          toAddresses: [ME],
          bccAddresses: ["a@x", "b@x", "c@x"],
        }),
        isOwn,
        nameFor,
      ),
    ).toBe("You → 3 recipients");
    expect(
      cardLabel(
        msg({ id: "m0", fromAddress: ME, toAddresses: [], bccAddresses: ["a@x"] }),
        isOwn,
        nameFor,
      ),
    ).toBe("You → 1 recipient");
    expect(
      cardLabel(msg({ id: "m0", fromAddress: ME, toAddresses: [ME] }), isOwn, nameFor),
    ).toBe("You");
  });
});

describe("answeredMessageIds", () => {
  it("marks cards an own message replies to, plus server-flagged ones", () => {
    const thread = [
      msg({ id: "a1", messageId: "<a1@x>" }),
      msg({ id: "b1", messageId: "<b1@x>", fromAddress: "bo@corp-b.example" }),
      msg({ id: "s1", messageId: "<s1@x>", fromAddress: ME, inReplyTo: "<a1@x>" }),
      msg({ id: "c1", messageId: "<c1@x>", isAnswered: true }),
      // Their reply to me does not count as me answering them.
      msg({ id: "a2", messageId: "<a2@x>", inReplyTo: "<s1@x>" }),
    ];
    expect([...answeredMessageIds(thread, isOwn)].sort()).toEqual(["a1", "c1"]);
  });
});

describe("defaultReplyTargetId", () => {
  const thread = [
    msg({ id: "m0", fromAddress: ME }),
    msg({ id: "a1" }),
    msg({ id: "s1", fromAddress: ME }),
  ];

  it("prefers a pinned draft, then the latest incoming, then the last message", () => {
    expect(defaultReplyTargetId(thread, isOwn, "m0")).toBe("m0");
    expect(defaultReplyTargetId(thread, isOwn, "gone")).toBe("a1");
    expect(defaultReplyTargetId(thread, isOwn)).toBe("a1");
    expect(defaultReplyTargetId([thread[0], thread[2]], isOwn)).toBe("s1");
    expect(defaultReplyTargetId([], isOwn)).toBeNull();
  });
});
