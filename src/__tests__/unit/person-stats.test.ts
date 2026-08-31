import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  computePersonStats,
  materialiseRank,
  rankPeople,
  rankWeight,
  type PersonStatsMessage,
} from "@/lib/mail/person-stats";

interface FixtureMessage {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  receivedAt: string;
  messageId: string | null;
  inReplyTo: string | null;
}

interface Fixture {
  now: string;
  own: string[];
  timezone: string;
  messages: FixtureMessage[];
  expectedRank: string[];
  expected: Record<
    string,
    {
      sentToThem: number;
      receivedFromThem: number;
      firstAt: string;
      lastAt: string;
      medianTheirReplySeconds: number | null;
      medianYourReplySeconds: number | null;
      histogram: Record<string, number>;
      score: number;
      position: number;
      of: number;
    }
  >;
}

const fixture: Fixture = JSON.parse(
  readFileSync(
    path.join(__dirname, "..", "fixtures", "person-rank.json"),
    "utf8",
  ),
);

function toRows(messages: FixtureMessage[]): PersonStatsMessage[] {
  return messages.map((m) => ({
    fromAddress: m.from,
    toAddresses: m.to,
    ccAddresses: m.cc,
    receivedAt: new Date(m.receivedAt),
    messageId: m.messageId,
    inReplyTo: m.inReplyTo,
  }));
}

function msg(
  over: Partial<PersonStatsMessage> & { fromAddress: string; receivedAt: Date },
): PersonStatsMessage {
  return {
    toAddresses: [],
    ccAddresses: [],
    messageId: null,
    inReplyTo: null,
    ...over,
  };
}

const own = { emails: ["me@example.com"], domains: [] };
const now = new Date("2026-08-31T12:00:00Z");
const H = 3600_000;

describe("person-rank fixture parity", () => {
  const rows = toRows(fixture.messages);
  const fixtureOwn = { emails: fixture.own, domains: [] };
  const fixtureNow = new Date(fixture.now);

  it("ranks people in the expected order", () => {
    const ranked = rankPeople(rows, fixtureOwn, fixtureNow);
    expect(ranked.map((r) => r.email)).toEqual(fixture.expectedRank);
  });

  it("materialises the same order and scores", () => {
    const rows = materialiseRank(toRows(fixture.messages), fixtureOwn, fixtureNow);
    expect(rows.map((r) => r.email)).toEqual(fixture.expectedRank);
    for (const row of rows) {
      expect(row.score).toBeCloseTo(fixture.expected[row.email].score, 1);
      expect(row.domain).toBe(row.email.split("@")[1]);
    }
  });

  for (const [email, expected] of Object.entries(fixture.expected)) {
    it(`matches the hand count for ${email}`, () => {
      const stats = computePersonStats({
        messages: rows,
        email,
        own: fixtureOwn,
        now: fixtureNow,
        timeZone: fixture.timezone,
      });
      expect(stats.sentToThem).toBe(expected.sentToThem);
      expect(stats.receivedFromThem).toBe(expected.receivedFromThem);
      expect(stats.firstAt?.toISOString()).toBe(
        new Date(expected.firstAt).toISOString(),
      );
      expect(stats.lastAt?.toISOString()).toBe(
        new Date(expected.lastAt).toISOString(),
      );
      expect(stats.medianTheirReplySeconds).toBe(
        expected.medianTheirReplySeconds,
      );
      expect(stats.medianYourReplySeconds).toBe(
        expected.medianYourReplySeconds,
      );
      const histogram: Record<string, number> = {};
      stats.hourHistogram.forEach((count, hour) => {
        if (count > 0) histogram[String(hour)] = count;
      });
      expect(histogram).toEqual(expected.histogram);
      expect(stats.rank.score).toBeCloseTo(expected.score, 1);
      expect(stats.rank.position).toBe(expected.position);
      expect(stats.rank.of).toBe(expected.of);
    });
  }
});

describe("rankWeight", () => {
  it("is 1 for a fresh non-reply and halves every 90 days", () => {
    expect(rankWeight(now, false, now)).toBe(1);
    const ninety = new Date(now.getTime() - 90 * 24 * H);
    expect(rankWeight(ninety, false, now)).toBeCloseTo(0.5, 10);
    const oneEighty = new Date(now.getTime() - 180 * 24 * H);
    expect(rankWeight(oneEighty, false, now)).toBeCloseTo(0.25, 10);
  });

  it("doubles for replies", () => {
    expect(rankWeight(now, true, now)).toBe(2);
    const ninety = new Date(now.getTime() - 90 * 24 * H);
    expect(rankWeight(ninety, true, now)).toBeCloseTo(1, 10);
  });

  it("never exceeds the fresh weight for future-dated mail", () => {
    const future = new Date(now.getTime() + 5 * 24 * H);
    expect(rankWeight(future, false, now)).toBe(1);
  });
});

describe("rankPeople", () => {
  it("credits recipients of your mail and senders of theirs, never you", () => {
    const rows = [
      msg({ fromAddress: "me@example.com", toAddresses: ["a@x.y"], ccAddresses: ["b@x.y", "ME@example.com"], receivedAt: now }),
      msg({ fromAddress: "c@x.y", toAddresses: ["me@example.com"], ccAddresses: ["a@x.y"], receivedAt: now }),
    ];
    const ranked = rankPeople(rows, own, now);
    expect(ranked.map((r) => r.email).sort()).toEqual(["a@x.y", "b@x.y", "c@x.y"]);
    // c's cc of a does not credit a: only the counterpart of the user counts.
    expect(ranked.find((r) => r.email === "a@x.y")?.score).toBeCloseTo(1, 10);
  });

  it("orders by score, then email for ties", () => {
    const rows = [
      msg({ fromAddress: "b@x.y", receivedAt: now }),
      msg({ fromAddress: "a@x.y", receivedAt: now }),
      msg({ fromAddress: "c@x.y", receivedAt: now, inReplyTo: "<x>" }),
    ];
    expect(rankPeople(rows, own, now).map((r) => r.email)).toEqual([
      "c@x.y",
      "a@x.y",
      "b@x.y",
    ]);
  });

  it("treats addresses case-insensitively", () => {
    const rows = [
      msg({ fromAddress: "Anna@X.y", receivedAt: now }),
      msg({ fromAddress: "anna@x.y", receivedAt: now }),
    ];
    const ranked = rankPeople(rows, own, now);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBeCloseTo(2, 10);
  });
});

describe("materialiseRank", () => {
  it("adds Bcc-only recipients of own mail at score 0, after everyone credited", () => {
    const rows = [
      { ...msg({ fromAddress: "me@example.com", toAddresses: ["a@x.y"], receivedAt: now }), bccAddresses: ["Hidden@X.Y", "me@example.com"] },
      { ...msg({ fromAddress: "old@x.y", receivedAt: new Date(now.getTime() - 900 * 24 * H) }) },
    ];
    const ranked = materialiseRank(rows, own, now);
    expect(ranked.map((r) => [r.email, r.score > 0])).toEqual([
      ["a@x.y", true],
      ["old@x.y", true],
      ["hidden@x.y", false],
    ]);
  });

  it("keeps the newest From name per address and none for recipients", () => {
    const rows = [
      { ...msg({ fromAddress: "a@x.y", receivedAt: new Date(now.getTime() - H) }), fromName: "Old Name" },
      { ...msg({ fromAddress: "A@x.y", receivedAt: now }), fromName: "Ada Lovelace" },
      { ...msg({ fromAddress: "me@example.com", toAddresses: ["b@x.y"], receivedAt: now }), fromName: "Me" },
    ];
    const ranked = materialiseRank(rows, own, now);
    expect(ranked.find((r) => r.email === "a@x.y")?.displayName).toBe("Ada Lovelace");
    expect(ranked.find((r) => r.email === "b@x.y")?.displayName).toBeNull();
  });

  it("uses a given rank instead of deriving one", () => {
    const stats = computePersonStats({
      messages: [msg({ fromAddress: "a@x.y", receivedAt: now })],
      email: "a@x.y",
      own,
      now,
      timeZone: "UTC",
      rank: { score: 9, position: 3, of: 41 },
    });
    expect(stats.rank).toEqual({ score: 9, position: 3, of: 41 });
  });
});

describe("computePersonStats", () => {
  it("pairs replies via inReplyTo in both directions and takes the median", () => {
    const t0 = new Date("2026-08-01T10:00:00Z");
    const rows = [
      msg({ fromAddress: "me@example.com", toAddresses: ["a@x.y"], receivedAt: t0, messageId: "<m1>" }),
      msg({ fromAddress: "a@x.y", toAddresses: ["me@example.com"], receivedAt: new Date(t0.getTime() + 1 * H), messageId: "<a1>", inReplyTo: "<m1>" }),
      msg({ fromAddress: "me@example.com", toAddresses: ["a@x.y"], receivedAt: new Date(t0.getTime() + 5 * H), messageId: "<m2>", inReplyTo: "<a1>" }),
      msg({ fromAddress: "a@x.y", toAddresses: ["me@example.com"], receivedAt: new Date(t0.getTime() + 8 * H), messageId: "<a2>", inReplyTo: "<m2>" }),
      msg({ fromAddress: "me@example.com", toAddresses: ["a@x.y"], receivedAt: new Date(t0.getTime() + 9 * H), messageId: "<m3>", inReplyTo: "<a2>" }),
      msg({ fromAddress: "a@x.y", toAddresses: ["me@example.com"], receivedAt: new Date(t0.getTime() + 19 * H), messageId: "<a3>", inReplyTo: "<m3>" }),
    ];
    const stats = computePersonStats({ messages: rows, email: "a@x.y", own, now, timeZone: "UTC" });
    // their replies: 1h, 3h, 10h -> median 3h; yours: 4h, 1h -> median 2.5h
    expect(stats.medianTheirReplySeconds).toBe(3 * 3600);
    expect(stats.medianYourReplySeconds).toBe(2.5 * 3600);
  });

  it("ignores replies to their own mail and replies whose parent is unknown", () => {
    const t0 = new Date("2026-08-01T10:00:00Z");
    const rows = [
      msg({ fromAddress: "a@x.y", toAddresses: ["me@example.com"], receivedAt: t0, messageId: "<a1>" }),
      msg({ fromAddress: "a@x.y", toAddresses: ["me@example.com"], receivedAt: new Date(t0.getTime() + H), messageId: "<a2>", inReplyTo: "<a1>" }),
      msg({ fromAddress: "a@x.y", toAddresses: ["me@example.com"], receivedAt: new Date(t0.getTime() + 2 * H), messageId: "<a3>", inReplyTo: "<missing>" }),
    ];
    const stats = computePersonStats({ messages: rows, email: "a@x.y", own, now, timeZone: "UTC" });
    expect(stats.medianTheirReplySeconds).toBeNull();
    expect(stats.medianYourReplySeconds).toBeNull();
    expect(stats.receivedFromThem).toBe(3);
  });

  it("buckets arrival hours in the given timezone with 24 buckets", () => {
    const rows = [
      msg({ fromAddress: "a@x.y", receivedAt: new Date("2026-01-10T23:30:00Z") }), // 00:30 Stockholm (CET)
      msg({ fromAddress: "a@x.y", receivedAt: new Date("2026-07-10T23:30:00Z") }), // 01:30 Stockholm (CEST)
      msg({ fromAddress: "me@example.com", toAddresses: ["a@x.y"], receivedAt: new Date("2026-07-10T12:00:00Z") }),
    ];
    const stats = computePersonStats({ messages: rows, email: "a@x.y", own, now, timeZone: "Europe/Stockholm" });
    expect(stats.hourHistogram).toHaveLength(24);
    expect(stats.hourHistogram[0]).toBe(1);
    expect(stats.hourHistogram[1]).toBe(1);
    expect(stats.hourHistogram.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("counts only their mail as received and only your mail with them on To/Cc as sent", () => {
    const rows = [
      msg({ fromAddress: "a@x.y", toAddresses: ["me@example.com"], receivedAt: now }),
      msg({ fromAddress: "me@example.com", ccAddresses: ["A@X.Y"], receivedAt: now }),
      msg({ fromAddress: "other@x.y", toAddresses: ["a@x.y"], ccAddresses: ["me@example.com"], receivedAt: now }),
    ];
    const stats = computePersonStats({ messages: rows, email: "a@x.y", own, now, timeZone: "UTC" });
    expect(stats.receivedFromThem).toBe(1);
    expect(stats.sentToThem).toBe(1);
  });

  it("returns an empty profile for an unknown person", () => {
    const stats = computePersonStats({ messages: [], email: "nobody@x.y", own, now, timeZone: "UTC" });
    expect(stats.sentToThem).toBe(0);
    expect(stats.firstAt).toBeNull();
    expect(stats.rank.position).toBeNull();
    expect(stats.rank.of).toBe(0);
    expect(stats.rank.score).toBe(0);
  });
});
