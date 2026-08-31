import { describe, it, expect, vi, beforeEach } from "vitest";

const messageFindMany = vi.fn();
const connectionFindMany = vi.fn();
const rankDeleteMany = vi.fn();
const rankCreateMany = vi.fn();
const rankFindUnique = vi.fn();
const rankCount = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    message: { findMany: (...args: unknown[]) => messageFindMany(...args) },
    emailConnection: {
      findMany: (...args: unknown[]) => connectionFindMany(...args),
    },
    personRank: {
      deleteMany: (...args: unknown[]) => rankDeleteMany(...args),
      createMany: (...args: unknown[]) => rankCreateMany(...args),
      findUnique: (...args: unknown[]) => rankFindUnique(...args),
      count: (...args: unknown[]) => rankCount(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

import {
  kickRankRecompute,
  readPersonRank,
  recomputePersonRank,
  resetRankKicks,
} from "@/lib/mail/person-rank-store";

const now = new Date("2026-08-31T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  resetRankKicks();
  connectionFindMany.mockResolvedValue([
    { email: "me@example.com", sendAsEmail: null, aliases: [], treatDomainAsOwn: false },
  ]);
  rankDeleteMany.mockReturnValue("delete-op");
  rankCreateMany.mockReturnValue("create-op");
  transaction.mockResolvedValue([]);
});

describe("recomputePersonRank", () => {
  it("replaces the user's rows with the whole-mailbox ranking in one transaction", async () => {
    messageFindMany.mockResolvedValue([
      {
        fromAddress: "Anna@Acme.se",
        fromName: "Anna Andersson",
        toAddresses: ["me@example.com"],
        ccAddresses: [],
        bccAddresses: [],
        receivedAt: now,
        messageId: "<a1>",
        inReplyTo: null,
      },
      {
        fromAddress: "me@example.com",
        fromName: "Me",
        toAddresses: ["bob@globex.com"],
        ccAddresses: [],
        bccAddresses: ["hidden@cc.only"],
        receivedAt: now,
        messageId: "<m1>",
        inReplyTo: null,
      },
    ]);

    const count = await recomputePersonRank("u1", now);

    expect(count).toBe(3);
    expect(messageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", isDraft: false } }),
    );
    expect(rankDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(rankCreateMany).toHaveBeenCalledWith({
      data: [
        {
          userId: "u1",
          email: "anna@acme.se",
          domain: "acme.se",
          displayName: "Anna Andersson",
          score: 1,
          computedAt: now,
        },
        {
          userId: "u1",
          email: "bob@globex.com",
          domain: "globex.com",
          displayName: null,
          score: 1,
          computedAt: now,
        },
        // Bcc-only: stored so compose can suggest it, never credited.
        {
          userId: "u1",
          email: "hidden@cc.only",
          domain: "cc.only",
          displayName: null,
          score: 0,
          computedAt: now,
        },
      ],
    });
    expect(transaction).toHaveBeenCalledWith(["delete-op", "create-op"]);
  });

  it("clears the table for a user with no mail", async () => {
    messageFindMany.mockResolvedValue([]);
    expect(await recomputePersonRank("u1", now)).toBe(0);
    expect(rankCreateMany).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledWith(["delete-op"]);
  });
});

describe("readPersonRank", () => {
  it("is null when the user has no rows yet", async () => {
    rankFindUnique.mockResolvedValue(null);
    rankCount.mockResolvedValue(0);
    expect(await readPersonRank("u1", "anna@acme.se")).toBeNull();
  });

  it("gives position by score desc, email asc, among the scored people", async () => {
    rankFindUnique.mockResolvedValue({ score: 3.5 });
    // total rows, scored rows ("of"), rows ahead
    rankCount.mockResolvedValueOnce(50).mockResolvedValueOnce(41).mockResolvedValueOnce(2);
    const rank = await readPersonRank("u1", "Bob@Globex.com");
    expect(rank).toEqual({ score: 3.5, position: 3, of: 41 });
    expect(rankFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_email: { userId: "u1", email: "bob@globex.com" } },
      }),
    );
    expect(rankCount).toHaveBeenNthCalledWith(2, {
      where: { userId: "u1", score: { gt: 0 } },
    });
    expect(rankCount).toHaveBeenLastCalledWith({
      where: {
        userId: "u1",
        OR: [
          { score: { gt: 3.5 } },
          { score: 3.5, email: { lt: "bob@globex.com" } },
        ],
      },
    });
  });

  it("gives no position for an address never exchanged with", async () => {
    rankFindUnique.mockResolvedValue(null);
    rankCount.mockResolvedValueOnce(50).mockResolvedValueOnce(41);
    expect(await readPersonRank("u1", "nobody@x.y")).toEqual({
      score: 0,
      position: null,
      of: 41,
    });
    // Seen (Cc'd on someone else's mail) but at score 0: no position either.
    rankFindUnique.mockResolvedValue({ score: 0 });
    rankCount.mockResolvedValueOnce(50).mockResolvedValueOnce(41);
    expect(await readPersonRank("u1", "copied@x.y")).toEqual({
      score: 0,
      position: null,
      of: 41,
    });
  });
});

describe("kickRankRecompute", () => {
  async function settle() {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  }

  it("returns synchronously and runs one recompute per kick burst", async () => {
    messageFindMany.mockResolvedValue([]);
    kickRankRecompute("u1");
    kickRankRecompute("u1");
    kickRankRecompute("u2");
    await settle();
    // u1: the first run plus one queued rerun (a kick mid-run means new
    // mail landed since the pass started); u2: one run.
    expect(rankDeleteMany).toHaveBeenCalledTimes(3);
  });

  it("allows a retry after a failure", async () => {
    connectionFindMany.mockRejectedValueOnce(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    kickRankRecompute("u1");
    await settle();
    messageFindMany.mockResolvedValue([]);
    kickRankRecompute("u1");
    await settle();
    expect(connectionFindMany).toHaveBeenCalledTimes(2);
    expect(rankDeleteMany).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("still runs a kick that landed while a failing run was in flight", async () => {
    let release!: () => void;
    connectionFindMany.mockReturnValueOnce(
      new Promise((_, reject) => {
        release = () => reject(new Error("boom"));
      }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    messageFindMany.mockResolvedValue([]);
    kickRankRecompute("u1");
    kickRankRecompute("u1"); // queued behind the run that is about to fail
    release();
    await settle();
    expect(rankDeleteMany).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
