import { describe, it, expect, vi, beforeEach } from "vitest";

const messageFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    sender: { findMany: vi.fn(async () => []) },
    contactEmail: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({ timezone: "UTC" })) },
    emailConnection: {
      findMany: vi.fn(async () => [
        { email: "me@example.com", sendAsEmail: null, aliases: [], treatDomainAsOwn: false },
      ]),
    },
    message: { findMany: (...args: unknown[]) => messageFindMany(...args) },
  },
}));

const readPersonRank = vi.fn();
const kickRankRecompute = vi.fn();
vi.mock("@/lib/mail/person-rank-store", () => ({
  readPersonRank: (...args: unknown[]) => readPersonRank(...args),
  kickRankRecompute: (...args: unknown[]) => kickRankRecompute(...args),
}));

import { getPersonProfile } from "@/lib/mail/person-profile";

const now = new Date("2026-08-31T12:00:00Z");
const involved = [
  {
    fromAddress: "anna@acme.se",
    toAddresses: ["me@example.com"],
    ccAddresses: [],
    receivedAt: now,
    messageId: "<a1>",
    inReplyTo: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  messageFindMany.mockResolvedValue(involved);
});

describe("getPersonProfile rank", () => {
  it("reads the materialised position instead of ranking the mailbox", async () => {
    readPersonRank.mockResolvedValue({ score: 10.3, position: 1, of: 41 });
    const profile = await getPersonProfile("u1", "Anna@Acme.se", { now });
    expect(profile.stats.rank).toEqual({ score: 10.3, position: 1, of: 41 });
    expect(readPersonRank).toHaveBeenCalledWith("u1", "anna@acme.se");
    // Only the person's own rows were read; no whole-mailbox pass.
    expect(messageFindMany).toHaveBeenCalledTimes(1);
    expect(kickRankRecompute).not.toHaveBeenCalled();
  });

  it("returns zeros and kicks materialisation when the table is empty", async () => {
    readPersonRank.mockResolvedValue(null);
    const profile = await getPersonProfile("u1", "anna@acme.se", { now });
    expect(profile.stats.rank).toEqual({ score: 0, position: null, of: 0 });
    expect(messageFindMany).toHaveBeenCalledTimes(1);
    expect(kickRankRecompute).toHaveBeenCalledWith("u1");
  });
});
