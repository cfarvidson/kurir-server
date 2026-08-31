import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const messageFindMany = vi.fn();
const rankFindMany = vi.fn();
const senderFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    message: { findMany: (...args: unknown[]) => messageFindMany(...args) },
    personRank: { findMany: (...args: unknown[]) => rankFindMany(...args) },
    sender: { findMany: (...args: unknown[]) => senderFindMany(...args) },
  },
}));

import {
  computeNetwork,
  loadPersonNetwork,
  networkStrengthLabel,
  threadStrength,
  type NetworkMessage,
} from "@/lib/mail/person-network";
import { materialiseRank, domainOf } from "@/lib/mail/person-stats";

interface Fixture {
  now: string;
  own: string[];
  messages: {
    id: string;
    threadId: string;
    from: string;
    to: string[];
    cc: string[];
    receivedAt: string;
    messageId: string | null;
    inReplyTo: string | null;
  }[];
  expectedNetwork: Record<
    string,
    { email: string; kind: string; sharedThreads: number; strength: number }[]
  >;
}

const fixture: Fixture = JSON.parse(
  readFileSync(path.join(__dirname, "..", "fixtures", "person-rank.json"), "utf8"),
);
const fixtureNow = new Date(fixture.now);
const fixtureOwn = { emails: fixture.own, domains: [] };
const fixtureMessages: NetworkMessage[] = fixture.messages.map((m) => ({
  id: m.id,
  threadId: m.threadId,
  fromAddress: m.from,
  toAddresses: m.to,
  ccAddresses: m.cc,
  receivedAt: new Date(m.receivedAt),
}));

const now = new Date("2026-08-31T12:00:00Z");
const own = { emails: ["me@z"], domains: [] };
const DAY = 24 * 3600_000;

function msg(
  over: Partial<NetworkMessage> & { id: string; fromAddress: string },
): NetworkMessage {
  return {
    threadId: null,
    toAddresses: [],
    ccAddresses: [],
    receivedAt: now,
    ...over,
  };
}

describe("person-rank fixture parity: Network", () => {
  const ranked = materialiseRank(
    fixture.messages.map((m) => ({
      fromAddress: m.from,
      toAddresses: m.to,
      ccAddresses: m.cc,
      receivedAt: new Date(m.receivedAt),
      messageId: m.messageId,
      inReplyTo: m.inReplyTo,
    })),
    fixtureOwn,
    fixtureNow,
  );

  for (const [email, expected] of Object.entries(fixture.expectedNetwork)) {
    it(`lists ${email}'s network in strength order`, () => {
      const network = computeNetwork({
        email,
        own: fixtureOwn,
        now: fixtureNow,
        messages: fixtureMessages,
        domainPeople: ranked.filter((r) => r.domain === domainOf(email)),
      });
      expect(network.map((n) => n.email)).toEqual(expected.map((n) => n.email));
      network.forEach((n, i) => {
        expect(n.kind).toBe(expected[i].kind);
        expect(n.sharedThreads).toBe(expected[i].sharedThreads);
        expect(n.strength).toBeCloseTo(expected[i].strength, 1);
      });
    });
  }
});

describe("networkStrengthLabel", () => {
  it("counts shared threads and names the domain fallback", () => {
    expect(networkStrengthLabel({ kind: "sharedThread", sharedThreads: 12 })).toBe("12 shared threads");
    expect(networkStrengthLabel({ kind: "sharedThread", sharedThreads: 1 })).toBe("1 shared thread");
    expect(networkStrengthLabel({ kind: "domain", sharedThreads: 0 })).toBe("same domain");
  });
});

describe("threadStrength", () => {
  it("is 1 for a thread touched today and halves every 90 days", () => {
    expect(threadStrength(now, now)).toBe(1);
    expect(threadStrength(new Date(now.getTime() - 90 * DAY), now)).toBeCloseTo(0.5, 10);
  });
});

describe("computeNetwork", () => {
  it("sums one weight per shared thread, dated by the thread's newest message", () => {
    const old = new Date(now.getTime() - 90 * DAY);
    const messages = [
      // Thread 1: two messages, bea on both; the newest dates the thread.
      msg({ id: "m1", threadId: "t1", fromAddress: "a@x.y", toAddresses: ["me@z", "bea@x.y"], receivedAt: old }),
      msg({ id: "m2", threadId: "t1", fromAddress: "bea@x.y", toAddresses: ["a@x.y"], receivedAt: now, fromName: "Bea" }),
      // Thread 2: fresh, cy on Cc.
      msg({ id: "m3", threadId: "t2", fromAddress: "me@z", toAddresses: ["a@x.y"], ccAddresses: ["cy@x.y"], receivedAt: now }),
      // Thread 3: old, bea again.
      msg({ id: "m4", threadId: "t3", fromAddress: "bea@x.y", toAddresses: ["a@x.y"], receivedAt: old }),
    ];
    const network = computeNetwork({ email: "A@x.y", own, now, messages, domainPeople: [] });
    expect(network.map((n) => [n.email, n.sharedThreads])).toEqual([
      ["bea@x.y", 2],
      ["cy@x.y", 1],
    ]);
    expect(network[0].strength).toBeCloseTo(1.5, 10);
    expect(network[0].displayName).toBe("Bea");
    expect(network[1].strength).toBeCloseTo(1, 10);
  });

  it("ignores threads the person is not on and never lists them or you", () => {
    const messages = [
      msg({ id: "m1", threadId: "t1", fromAddress: "a@x.y", toAddresses: ["me@z"] }),
      msg({ id: "m2", threadId: "other", fromAddress: "stranger@q.r", toAddresses: ["me@z", "bea@x.y"] }),
    ];
    const network = computeNetwork({ email: "a@x.y", own, now, messages, domainPeople: [] });
    expect(network).toEqual([]);
  });

  it("treats a message without threadId as its own thread", () => {
    const messages = [
      msg({ id: "m1", fromAddress: "a@x.y", toAddresses: ["me@z"], ccAddresses: ["bea@x.y"] }),
      msg({ id: "m2", fromAddress: "a@x.y", toAddresses: ["me@z"], ccAddresses: ["bea@x.y"] }),
    ];
    const network = computeNetwork({ email: "a@x.y", own, now, messages, domainPeople: [] });
    expect(network[0].sharedThreads).toBe(2);
  });

  it("adds same-domain people at their Rank score, after a shared-thread tie", () => {
    const messages = [
      msg({ id: "m1", threadId: "t1", fromAddress: "a@acme.se", toAddresses: ["me@z", "bea@acme.se"] }),
    ];
    const network = computeNetwork({
      email: "a@acme.se",
      own,
      now,
      messages,
      domainPeople: [
        { email: "bea@acme.se", displayName: "Bea", score: 7 }, // already a shared-thread neighbour
        { email: "dan@acme.se", displayName: "Dan", score: 1 }, // ties with bea's one fresh thread
        { email: "zed@acme.se", displayName: null, score: 4 },
        { email: "a@acme.se", displayName: "Self", score: 9 },
        { email: "me@z", displayName: "Me", score: 9 },
      ],
    });
    expect(network.map((n) => [n.email, n.kind, n.strength])).toEqual([
      ["zed@acme.se", "domain", 4],
      ["bea@acme.se", "sharedThread", 1],
      ["dan@acme.se", "domain", 1],
    ]);
    expect(network[1].sharedThreads).toBe(1);
    expect(network[2].sharedThreads).toBe(0);
  });
});

describe("loadPersonNetwork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    senderFindMany.mockResolvedValue([]);
    rankFindMany.mockResolvedValue([]);
  });

  it("collects the person's threads, then everyone on them, then domain people by Rank", async () => {
    messageFindMany
      .mockResolvedValueOnce([
        { id: "m1", threadId: "t1" },
        { id: "m9", threadId: null },
      ])
      .mockResolvedValueOnce([
        msg({ id: "m1", threadId: "t1", fromAddress: "a@acme.se", toAddresses: ["me@z", "bea@acme.se"] }),
        msg({ id: "m9", threadId: null, fromAddress: "cy@q.r", toAddresses: ["a@acme.se"], fromName: "Cy Header" }),
      ]);
    rankFindMany.mockResolvedValue([
      { email: "dan@acme.se", displayName: null, score: 0.5 },
    ]);
    senderFindMany.mockResolvedValue([{ email: "bea@acme.se", displayName: "Bea Sender" }]);

    const network = await loadPersonNetwork("u1", "A@acme.se", own, now);

    // To/Cc are stored as received: both spellings are matched.
    expect(messageFindMany.mock.calls[0][0].where.OR).toEqual([
      { fromAddress: { equals: "a@acme.se", mode: "insensitive" } },
      { toAddresses: { hasSome: ["A@acme.se", "a@acme.se"] } },
      { ccAddresses: { hasSome: ["A@acme.se", "a@acme.se"] } },
    ]);
    expect(messageFindMany.mock.calls[1][0].where.OR).toEqual([
      { threadId: { in: ["t1"] } },
      { id: { in: ["m9"] } },
    ]);
    expect(rankFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", domain: "acme.se", NOT: { email: "a@acme.se" } },
      }),
    );
    expect(network.map((n) => [n.email, n.displayName, n.kind])).toEqual([
      ["bea@acme.se", "Bea Sender", "sharedThread"],
      ["cy@q.r", "Cy Header", "sharedThread"],
      ["dan@acme.se", null, "domain"],
    ]);
  });

  it("skips the thread query when the person is on no mail", async () => {
    messageFindMany.mockResolvedValueOnce([]);
    expect(await loadPersonNetwork("u1", "nobody@x.y", own, now)).toEqual([]);
    expect(messageFindMany).toHaveBeenCalledTimes(1);
    expect(senderFindMany).not.toHaveBeenCalled();
  });
});
