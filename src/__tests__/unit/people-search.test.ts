import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const rankFindMany = vi.fn();
const contactFindMany = vi.fn();
const senderFindMany = vi.fn();
const connectionFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    personRank: { findMany: (...args: unknown[]) => rankFindMany(...args) },
    contact: { findMany: (...args: unknown[]) => contactFindMany(...args) },
    sender: { findMany: (...args: unknown[]) => senderFindMany(...args) },
    emailConnection: {
      findMany: (...args: unknown[]) => connectionFindMany(...args),
    },
  },
}));

import {
  domainLabelPrefix,
  findPeople,
  matchPerson,
  personPrefixWhere,
  rankedPeople,
  tokenPrefix,
  type PersonCandidate,
} from "@/lib/mail/people-search";
import { materialiseRank } from "@/lib/mail/person-stats";

interface Fixture {
  now: string;
  own: string[];
  names: Record<string, string>;
  messages: {
    from: string;
    to: string[];
    cc: string[];
    receivedAt: string;
    messageId: string | null;
    inReplyTo: string | null;
  }[];
  expectedPeopleSearch: Record<string, string[]>;
  expectedDomainTypeahead: Record<string, { domain: string; people: string[] } | null>;
}

const fixture: Fixture = JSON.parse(
  readFileSync(path.join(__dirname, "..", "fixtures", "person-rank.json"), "utf8"),
);

/** The fixture mailbox as ranked candidates with the fixture's names. */
const fixturePeople: PersonCandidate[] = materialiseRank(
  fixture.messages.map((m) => ({
    fromAddress: m.from,
    toAddresses: m.to,
    ccAddresses: m.cc,
    receivedAt: new Date(m.receivedAt),
    messageId: m.messageId,
    inReplyTo: m.inReplyTo,
  })),
  { emails: fixture.own, domains: [] },
  new Date(fixture.now),
).map((r) => ({ ...r, displayName: fixture.names[r.email] ?? null }));

describe("person-rank fixture parity: people search", () => {
  for (const [query, expected] of Object.entries(fixture.expectedPeopleSearch)) {
    it(`"${query}" gives ${JSON.stringify(expected)}`, () => {
      expect(rankedPeople(fixturePeople, query, 10).map((p) => p.email)).toEqual(
        expected,
      );
    });
  }

  for (const [query, expected] of Object.entries(fixture.expectedDomainTypeahead)) {
    it(`"${query}" ${expected ? `hints at ${expected.domain}` : "hints at no domain"}`, () => {
      const hits = rankedPeople(fixturePeople, query, 10);
      if (expected) {
        expect(hits.map((h) => h.email)).toEqual(expected.people);
        expect(new Set(hits.map((h) => h.domainHint))).toEqual(new Set([expected.domain]));
      } else {
        expect(hits.every((h) => h.domainHint === null)).toBe(true);
      }
    });
  }
});

describe("prefix rules", () => {
  it("matches a first or last name, never the middle of a word", () => {
    expect(tokenPrefix("Maria Karlsson", "ma")).toBe(true);
    expect(tokenPrefix("Maria Karlsson", "karl")).toBe(true);
    expect(tokenPrefix("Maria Karlsson", "aria")).toBe(false);
    expect(tokenPrefix(null, "m")).toBe(false);
  });

  it("matches a domain label", () => {
    expect(domainLabelPrefix("tv4.se", "tv4")).toBe(true);
    expect(domainLabelPrefix("mail.tv4.se", "tv4")).toBe(true);
    expect(domainLabelPrefix("tv4.se", "v4")).toBe(false);
  });

  it("reports what matched, name first", () => {
    const maria: PersonCandidate = {
      email: "maria@tv4.se",
      displayName: "Maria Karlsson",
      domain: "tv4.se",
      score: 1,
      company: "TV4 Media",
    };
    expect(matchPerson(maria, "MA")).toBe("name");
    expect(matchPerson(maria, "maria@t")).toBe("address");
    expect(matchPerson(maria, "tv4")).toBe("domain");
    expect(matchPerson({ ...maria, domain: "x.y", email: "m@x.y" }, "media")).toBe("company");
    expect(matchPerson(maria, "aria")).toBeNull();
    expect(matchPerson(maria, "  ")).toBeNull();
  });

  it("puts Maria before a lower-ranked Mats", () => {
    const people: PersonCandidate[] = [
      { email: "mats@x.y", displayName: "Mats", domain: "x.y", score: 0.4 },
      { email: "maria@x.y", displayName: "Maria", domain: "x.y", score: 9 },
    ];
    expect(rankedPeople(people, "ma", 5).map((p) => p.email)).toEqual([
      "maria@x.y",
      "mats@x.y",
    ]);
  });

  it("orders ties by name then address and caps", () => {
    const people: PersonCandidate[] = [
      { email: "b@x.y", displayName: "Ann B", domain: "x.y", score: 1 },
      { email: "a@x.y", displayName: "Ann A", domain: "x.y", score: 1 },
      { email: "c@x.y", displayName: null, domain: "x.y", score: 1 },
    ];
    expect(rankedPeople(people, "x", 2).map((p) => p.email)).toEqual(["a@x.y", "b@x.y"]);
  });

  it("builds the same rules for the database", () => {
    expect(personPrefixWhere(" Tv4 ")).toEqual([
      { displayName: { startsWith: "tv4", mode: "insensitive" } },
      { displayName: { contains: " tv4", mode: "insensitive" } },
      { email: { startsWith: "tv4" } },
      { domain: { startsWith: "tv4" } },
      { domain: { contains: ".tv4" } },
    ]);
  });
});

describe("findPeople", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionFindMany.mockResolvedValue([
      { email: "me@example.com", sendAsEmail: null, aliases: [], treatDomainAsOwn: false },
    ]);
    rankFindMany.mockResolvedValue([]);
    contactFindMany.mockResolvedValue([]);
    senderFindMany.mockResolvedValue([]);
  });

  it("suggests an address that only ever appeared in Cc, ordered by Rank", async () => {
    rankFindMany.mockResolvedValueOnce([
      { email: "cc-only@acme.se", displayName: null, domain: "acme.se", score: 2 },
      { email: "anna@acme.se", displayName: "Anna Andersson", domain: "acme.se", score: 10 },
    ]);
    senderFindMany
      .mockResolvedValueOnce([]) // no company matches "acme"
      .mockResolvedValueOnce([
        // Only Anna ever sent mail; the Cc-only address has no Sender row.
        { email: "anna@acme.se", displayName: "Anna A", status: "APPROVED", category: "IMBOX", contactEmails: [] },
      ]);
    const people = await findPeople("u1", "acme", 8);
    expect(people.map((p) => [p.email, p.domainHint])).toEqual([
      ["anna@acme.se", "acme.se"],
      ["cc-only@acme.se", "acme.se"],
    ]);
    expect(rankFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", OR: personPrefixWhere("acme") },
        orderBy: [{ score: "desc" }, { email: "asc" }],
      }),
    );
  });

  it("excludes own addresses and senders that are rejected or unscreened", async () => {
    rankFindMany.mockResolvedValueOnce([
      { email: "me@example.com", displayName: "Me", domain: "example.com", score: 50 },
      { email: "spam@x.y", displayName: "Spammy", domain: "x.y", score: 5 },
      { email: "new@x.y", displayName: "Newcomer", domain: "x.y", score: 4 },
      { email: "ok@x.y", displayName: "Ok Person", domain: "x.y", score: 1 },
    ]);
    senderFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { email: "spam@x.y", displayName: "Spammy", status: "REJECTED", category: null, contactEmails: [] },
      { email: "new@x.y", displayName: "Newcomer", status: "PENDING", category: "IMBOX", contactEmails: [] },
      { email: "ok@x.y", displayName: "Ok Person", status: "APPROVED", category: "FEED", contactEmails: [] },
    ]);
    const people = await findPeople("u1", "x.y", 8);
    expect(people.map((p) => p.email)).toEqual(["ok@x.y"]);
    expect(people[0].category).toBe("FEED");
  });

  it("keeps a Contact whose sender row is still unscreened", async () => {
    rankFindMany.mockResolvedValueOnce([
      { email: "new@x.y", displayName: "Newcomer", domain: "x.y", score: 4 },
    ]);
    contactFindMany.mockResolvedValue([
      { id: "c1", name: "New Contact", emails: [{ email: "new@x.y" }] },
    ]);
    senderFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { email: "new@x.y", displayName: "Newcomer", status: "PENDING", category: "IMBOX", contactEmails: [] },
    ]);
    const people = await findPeople("u1", "new", 8);
    expect(people.map((p) => [p.email, p.displayName, p.contactId])).toEqual([
      ["new@x.y", "New Contact", "c1"],
    ]);
  });

  it("merges a Contact onto the ranked address, name winning, one row per contact", async () => {
    rankFindMany
      .mockResolvedValueOnce([
        { email: "ada@work.y", displayName: "A. Lovelace", domain: "work.y", score: 3 },
      ])
      // Rank lookup for the contact's other address.
      .mockResolvedValueOnce([{ email: "ada@home.y", score: 1 }]);
    contactFindMany.mockResolvedValue([
      { id: "c1", name: "Ada Lovelace", emails: [{ email: "ada@home.y" }, { email: "ADA@work.y" }] },
    ]);
    const people = await findPeople("u1", "ada", 8);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      email: "ada@work.y",
      displayName: "Ada Lovelace",
      contactId: "c1",
      score: 3,
      emails: ["ada@home.y", "ada@work.y"],
      matchedBy: "name",
      domainHint: null,
    });
  });

  it("returns the top people at a domain for a company fragment", async () => {
    // No prefix hit on any person; the company query finds the domain.
    rankFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { email: "boss@tv4.se", displayName: "Big Boss", domain: "tv4.se", score: 9 },
        { email: "anna@tv4.se", displayName: "Anna", domain: "tv4.se", score: 2 },
      ]);
    senderFindMany
      .mockResolvedValueOnce([{ domain: "tv4.se", signatureCompany: "TV4 Media AB" }])
      .mockResolvedValueOnce([]);
    const people = await findPeople("u1", "media", 8);
    expect(senderFindMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        where: {
          userId: "u1",
          OR: [
            { signatureCompany: { startsWith: "media", mode: "insensitive" } },
            { signatureCompany: { contains: " media", mode: "insensitive" } },
          ],
        },
        select: { domain: true, signatureCompany: true },
        distinct: ["domain"],
      }),
    );
    expect(people.map((p) => [p.email, p.matchedBy, p.domainHint])).toEqual([
      ["boss@tv4.se", "company", "tv4.se"],
      ["anna@tv4.se", "company", "tv4.se"],
    ]);
  });

  it("skips the company lookup for a query with an @", async () => {
    await findPeople("u1", "anna@", 8);
    expect(senderFindMany).not.toHaveBeenCalled();
  });

  it("caps at the limit and answers nothing for a blank query", async () => {
    rankFindMany.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => ({
        email: `p${i}@acme.se`,
        displayName: `Person ${i}`,
        domain: "acme.se",
        score: 12 - i,
      })),
    );
    expect(await findPeople("u1", "acme", 8)).toHaveLength(8);
    expect(await findPeople("u1", "   ", 8)).toEqual([]);
  });
});
