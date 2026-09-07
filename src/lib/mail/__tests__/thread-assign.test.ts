import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the shared thread-assignment used by ingest and all three send
 * paths (kurir-server#137): related-thread reuse, root fallback to the own
 * Message-ID, unify/back-fill of null-threadId anchors, and the
 * references-aware repair that no longer un-threads replies whose direct
 * parent is missing from the DB.
 *
 * The db mock is a tiny in-memory message store implementing exactly the
 * query shapes thread-assign issues (findFirst / updateMany / findMany).
 */

interface Row {
  id: string;
  userId: string;
  messageId: string | null;
  threadId: string | null;
  splitFromThreadId: string | null;
  inReplyTo: string | null;
  references: string[];
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  sentAt: Date | null;
  receivedAt: Date;
}

let rows: Row[];
/** Own addresses returned by the mocked emailConnection lookup (repair). */
let ownEmails: string[];

type InFilter = { in: string[] };
type Where = {
  userId?: string;
  OR?: Array<{
    messageId?: InFilter;
    threadId?: InFilter;
    inReplyTo?: InFilter;
  }>;
  messageId?: InFilter;
  threadId?: { not: null } | InFilter;
  splitFromThreadId?: string | null;
  fromAddress?: { equals: string; mode: "insensitive" };
  NOT?: { threadId: string };
  id?: InFilter;
};

function matches(row: Row, where: Where): boolean {
  if (where.userId && row.userId !== where.userId) return false;
  if (where.id && !where.id.in.includes(row.id)) return false;
  if (where.messageId) {
    if (row.messageId === null || !where.messageId.in.includes(row.messageId)) {
      return false;
    }
  }
  if (where.threadId) {
    if ("not" in where.threadId && row.threadId === null) return false;
    if (
      "in" in where.threadId &&
      (row.threadId === null || !where.threadId.in.includes(row.threadId))
    ) {
      return false;
    }
  }
  if ("splitFromThreadId" in where) {
    if ((row.splitFromThreadId ?? null) !== (where.splitFromThreadId ?? null)) {
      return false;
    }
  }
  if (where.fromAddress) {
    if (
      row.fromAddress.toLowerCase() !== where.fromAddress.equals.toLowerCase()
    ) {
      return false;
    }
  }
  if (where.NOT && row.threadId === where.NOT.threadId) return false;
  if (where.OR) {
    const any = where.OR.some((clause) => {
      if (clause.messageId) {
        return row.messageId !== null && clause.messageId.in.includes(row.messageId);
      }
      if (clause.threadId) {
        return row.threadId !== null && clause.threadId.in.includes(row.threadId);
      }
      if (clause.inReplyTo) {
        return row.inReplyTo !== null && clause.inReplyTo.in.includes(row.inReplyTo);
      }
      return false;
    });
    if (!any) return false;
  }
  return true;
}

function ordered(list: Row[], orderBy?: { receivedAt?: "asc" }): Row[] {
  if (!orderBy?.receivedAt) return list;
  return [...list].sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
  );
}

vi.mock("@/lib/db", () => ({
  db: {
    message: {
      findFirst: vi.fn(
        async ({
          where,
          orderBy,
        }: {
          where: Where;
          orderBy?: { receivedAt?: "asc" };
        }) => {
          return (
            ordered(
              rows.filter((r) => matches(r, where)),
              orderBy,
            )[0] ?? null
          );
        },
      ),
      findMany: vi.fn(async ({ where }: { where: Where }) => {
        return rows.filter((r) => matches(r, where));
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Where;
          data: { threadId: string; splitFromThreadId?: string | null };
        }) => {
          let count = 0;
          for (const r of rows) {
            if (matches(r, where)) {
              r.threadId = data.threadId;
              if ("splitFromThreadId" in data) {
                r.splitFromThreadId = data.splitFromThreadId ?? null;
              }
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
    emailConnection: {
      findMany: vi.fn(async () =>
        ownEmails.map((email) => ({
          email,
          sendAsEmail: null,
          aliases: [],
          treatDomainAsOwn: false,
        })),
      ),
    },
  },
}));

import {
  assignThread,
  isBroadcast,
  nearestFirstAncestorIds,
  repairThreadIds,
} from "@/lib/mail/thread-assign";

let seq = 0;
function row(partial: Partial<Row> & { id: string }): Row {
  seq += 1;
  return {
    userId: "u1",
    messageId: null,
    threadId: null,
    splitFromThreadId: null,
    inReplyTo: null,
    references: [],
    fromAddress: "someone@else.example",
    toAddresses: [],
    ccAddresses: [],
    sentAt: null,
    receivedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)),
    ...partial,
  };
}

const ME = "me@mine.example";
const own = { emails: [ME], domains: [] };

beforeEach(() => {
  rows = [];
  ownEmails = [ME];
  vi.clearAllMocks();
});

describe("assignThread (thread key)", () => {
  it("reuses the threadId of a known related message", async () => {
    rows.push(row({ id: "m1", messageId: "<a@x>", threadId: "<t@x>" }));

    const { threadId } = await assignThread({
      userId: "u1",
      messageId: "<b@x>",
      inReplyTo: "<a@x>",
      references: ["<a@x>"],
    });

    expect(threadId).toBe("<t@x>");
  });

  it("back-fills a null-threadId anchor so anchor and reply share one thread", async () => {
    const anchor = row({ id: "m1", messageId: "<a@x>", threadId: null });
    rows.push(anchor);

    const { threadId } = await assignThread({
      userId: "u1",
      messageId: "<b@x>",
      inReplyTo: "<a@x>",
      references: ["<a@x>"],
    });

    expect(threadId).toBe("<a@x>");
    expect(anchor.threadId).toBe("<a@x>");
  });

  it("falls back to the message's own Message-ID for a fresh conversation", async () => {
    const { threadId } = await assignThread({
      userId: "u1",
      messageId: "<new@x>",
      inReplyTo: null,
      references: [],
    });

    expect(threadId).toBe("<new@x>");
  });

  it("uses the conversation root from references when no related row exists", async () => {
    const { threadId } = await assignThread({
      userId: "u1",
      messageId: "<c@x>",
      inReplyTo: "<b@x>",
      references: ["<a@x>", "<b@x>"],
    });

    expect(threadId).toBe("<a@x>");
  });

  it("unifies divergent threadIds across the conversation", async () => {
    const sibling = row({
      id: "m1",
      messageId: "<b@x>",
      threadId: "<b@x>",
      inReplyTo: "<a@x>",
    });
    const anchor = row({ id: "m2", messageId: "<a@x>", threadId: "<a@x>" });
    rows.push(anchor, sibling);

    const { threadId } = await assignThread({
      userId: "u1",
      messageId: "<c@x>",
      inReplyTo: "<a@x>",
      references: ["<a@x>"],
    });

    expect(threadId).toBe("<a@x>");
    // The sibling replied to the same anchor — it converges onto the thread.
    expect(sibling.threadId).toBe("<a@x>");
  });

  it("scopes lookup and unify to the user", async () => {
    const otherUsers = row({
      id: "m1",
      userId: "u2",
      messageId: "<a@x>",
      threadId: "<t@x>",
    });
    rows.push(otherUsers);

    const { threadId } = await assignThread({
      userId: "u1",
      messageId: "<b@x>",
      inReplyTo: "<a@x>",
      references: ["<a@x>"],
    });

    expect(threadId).toBe("<a@x>");
    expect(otherUsers.threadId).toBe("<t@x>");
  });
});

describe("repairThreadIds", () => {
  it("does not move a references-linked reply out of its thread when the direct parent is missing", async () => {
    // A is missing from the DB; B and C were ingested with threadId <a@x>.
    const b = row({
      id: "m1",
      messageId: "<b@x>",
      threadId: "<a@x>",
      inReplyTo: "<a@x>",
      references: ["<a@x>"],
    });
    const c = row({
      id: "m2",
      messageId: "<c@x>",
      threadId: "<a@x>",
      inReplyTo: "<b@x>",
      references: ["<a@x>", "<b@x>"],
    });
    rows.push(b, c);

    await repairThreadIds("u1");

    expect(b.threadId).toBe("<a@x>");
    expect(c.threadId).toBe("<a@x>");
  });

  it("walks references when inReplyTo's target is missing", async () => {
    // C replies to B (missing) which replied to A (present, standalone).
    const a = row({ id: "m1", messageId: "<a@x>", threadId: "<a@x>" });
    const c = row({
      id: "m2",
      messageId: "<c@x>",
      threadId: "<c@x>",
      inReplyTo: "<b@x>",
      references: ["<a@x>", "<b@x>"],
    });
    rows.push(a, c);

    await repairThreadIds("u1");

    expect(c.threadId).toBe("<a@x>");
  });

  it("unifies a chain onto the root's Message-ID", async () => {
    const a = row({ id: "m1", messageId: "<a@x>", threadId: null });
    const b = row({
      id: "m2",
      messageId: "<b@x>",
      threadId: "<b@x>",
      inReplyTo: "<a@x>",
      references: ["<a@x>"],
    });
    rows.push(a, b);

    await repairThreadIds("u1");

    expect(a.threadId).toBe("<a@x>");
    expect(b.threadId).toBe("<a@x>");
  });

  it("gives a standalone message its own Message-ID as threadId", async () => {
    const a = row({ id: "m1", messageId: "<a@x>", threadId: null });
    rows.push(a);

    await repairThreadIds("u1");

    expect(a.threadId).toBe("<a@x>");
  });

  it("aligns descendants with a top ancestor whose own parent is missing", async () => {
    // B's parent A is missing; B kept threadId <a@x>. C replies to B and
    // diverged. Both must end up on B's thread key, not B's Message-ID.
    const b = row({
      id: "m1",
      messageId: "<b@x>",
      threadId: "<a@x>",
      inReplyTo: "<a@x>",
      references: ["<a@x>"],
    });
    const c = row({
      id: "m2",
      messageId: "<c@x>",
      threadId: "<c@x>",
      inReplyTo: "<b@x>",
      references: ["<a@x>", "<b@x>"],
    });
    rows.push(b, c);

    await repairThreadIds("u1");

    expect(b.threadId).toBe("<a@x>");
    expect(c.threadId).toBe("<a@x>");
  });

  it("survives reply-chain cycles", async () => {
    const a = row({
      id: "m1",
      messageId: "<a@x>",
      threadId: "<a@x>",
      inReplyTo: "<b@x>",
      references: ["<b@x>"],
    });
    const b = row({
      id: "m2",
      messageId: "<b@x>",
      threadId: "<b@x>",
      inReplyTo: "<a@x>",
      references: ["<a@x>"],
    });
    rows.push(a, b);

    await expect(repairThreadIds("u1")).resolves.toBeUndefined();
  });
});

describe("nearestFirstAncestorIds", () => {
  it("orders inReplyTo first, then references newest → oldest, deduped", () => {
    expect(
      nearestFirstAncestorIds("<c@x>", ["<a@x>", "<b@x>", "<c@x>"]),
    ).toEqual(["<c@x>", "<b@x>", "<a@x>"]);
  });
});

describe("isBroadcast", () => {
  it("is true for an own message whose To/Cc hold only own addresses", () => {
    expect(
      isBroadcast(
        { fromAddress: ME, toAddresses: [ME], ccAddresses: [] },
        own,
      ),
    ).toBe(true);
    expect(
      isBroadcast(
        { fromAddress: ME, toAddresses: [], ccAddresses: [] },
        own,
      ),
    ).toBe(true);
  });

  it("is false with an external To/Cc address or an external sender", () => {
    expect(
      isBroadcast(
        { fromAddress: ME, toAddresses: ["team@corp.example"], ccAddresses: [] },
        own,
      ),
    ).toBe(false);
    expect(
      isBroadcast(
        { fromAddress: "a@corp.example", toAddresses: [], ccAddresses: [] },
        own,
      ),
    ).toBe(false);
  });
});

describe("assignThread branches (plan 055)", () => {
  function broadcast() {
    return row({
      id: "m0",
      messageId: "<m0@x>",
      threadId: "<m0@x>",
      fromAddress: ME,
      toAddresses: [ME],
    });
  }

  it("starts a branch for an external reply to an own bcc broadcast", async () => {
    const m0 = broadcast();
    rows.push(m0);

    const a = await assignThread({
      userId: "u1",
      messageId: "<a1@corp-a>",
      inReplyTo: "<m0@x>",
      references: ["<m0@x>"],
      fromAddress: "anna@corp-a.example",
      own,
    });

    expect(a).toEqual({ threadId: "<a1@corp-a>", splitFromThreadId: "<m0@x>" });
    // The broadcast stays in its own thread — a branch pulls nothing in.
    expect(m0.threadId).toBe("<m0@x>");
    expect(m0.splitFromThreadId).toBeNull();
  });

  it("gives each replying address its own branch", async () => {
    rows.push(broadcast());
    rows.push(
      row({
        id: "a1",
        messageId: "<a1@corp-a>",
        threadId: "<a1@corp-a>",
        splitFromThreadId: "<m0@x>",
        inReplyTo: "<m0@x>",
        references: ["<m0@x>"],
        fromAddress: "anna@corp-a.example",
      }),
    );

    const b = await assignThread({
      userId: "u1",
      messageId: "<b1@corp-b>",
      inReplyTo: "<m0@x>",
      references: ["<m0@x>"],
      fromAddress: "bo@corp-b.example",
      own,
    });

    expect(b).toEqual({ threadId: "<b1@corp-b>", splitFromThreadId: "<m0@x>" });
  });

  it("joins a second reply from the same address to its existing branch (case-insensitive)", async () => {
    rows.push(broadcast());
    rows.push(
      row({
        id: "a1",
        messageId: "<a1@corp-a>",
        threadId: "<a1@corp-a>",
        splitFromThreadId: "<m0@x>",
        inReplyTo: "<m0@x>",
        references: ["<m0@x>"],
        fromAddress: "anna@corp-a.example",
      }),
    );

    const a2 = await assignThread({
      userId: "u1",
      messageId: "<a2@corp-a>",
      inReplyTo: "<m0@x>",
      references: ["<m0@x>"],
      fromAddress: "Anna@Corp-A.example",
      own,
    });

    expect(a2).toEqual({ threadId: "<a1@corp-a>", splitFromThreadId: "<m0@x>" });
  });

  it("keeps my reply and their follow-up inside the branch although References name the broadcast", async () => {
    rows.push(broadcast());
    const a1 = row({
      id: "a1",
      messageId: "<a1@corp-a>",
      threadId: "<a1@corp-a>",
      splitFromThreadId: "<m0@x>",
      inReplyTo: "<m0@x>",
      references: ["<m0@x>"],
      fromAddress: "anna@corp-a.example",
    });
    rows.push(a1);

    // My reply to Anna (send path: no fromAddress/own needed).
    const mine = await assignThread({
      userId: "u1",
      messageId: "<s1@x>",
      inReplyTo: "<a1@corp-a>",
      references: ["<m0@x>", "<a1@corp-a>"],
    });
    expect(mine).toEqual({ threadId: "<a1@corp-a>", splitFromThreadId: "<m0@x>" });
    rows.push(
      row({
        id: "s1",
        messageId: "<s1@x>",
        threadId: mine.threadId,
        splitFromThreadId: mine.splitFromThreadId,
        inReplyTo: "<a1@corp-a>",
        references: ["<m0@x>", "<a1@corp-a>"],
        fromAddress: ME,
        toAddresses: ["anna@corp-a.example"],
      }),
    );

    // Anna's follow-up replies to my reply.
    const a2 = await assignThread({
      userId: "u1",
      messageId: "<a2@corp-a>",
      inReplyTo: "<s1@x>",
      references: ["<m0@x>", "<a1@corp-a>", "<s1@x>"],
      fromAddress: "anna@corp-a.example",
      own,
    });
    expect(a2).toEqual({ threadId: "<a1@corp-a>", splitFromThreadId: "<m0@x>" });
    // Nothing leaked into the broadcast thread.
    expect(rows.find((r) => r.id === "m0")!.threadId).toBe("<m0@x>");
  });

  it("does not split replies to a message with a visible external recipient (group alias)", async () => {
    rows.push(
      row({
        id: "m0",
        messageId: "<m0@x>",
        threadId: "<m0@x>",
        fromAddress: ME,
        toAddresses: ["team@corp.example"],
      }),
    );

    const reply = await assignThread({
      userId: "u1",
      messageId: "<r@corp>",
      inReplyTo: "<m0@x>",
      references: ["<m0@x>"],
      fromAddress: "carl@corp.example",
      own,
    });

    expect(reply).toEqual({ threadId: "<m0@x>", splitFromThreadId: null });
  });

  it("does not split when the sender is own (my own copy of the broadcast)", async () => {
    rows.push(broadcast());

    const reply = await assignThread({
      userId: "u1",
      messageId: "<m1@x>",
      inReplyTo: "<m0@x>",
      references: ["<m0@x>"],
      fromAddress: ME,
      own,
    });

    expect(reply).toEqual({ threadId: "<m0@x>", splitFromThreadId: null });
  });

  it("does not split without sender context (send paths)", async () => {
    rows.push(broadcast());

    const reply = await assignThread({
      userId: "u1",
      messageId: "<x@corp>",
      inReplyTo: "<m0@x>",
      references: ["<m0@x>"],
    });

    expect(reply).toEqual({ threadId: "<m0@x>", splitFromThreadId: null });
  });

  it("never unifies branch rows into the broadcast thread", async () => {
    const m0 = broadcast();
    const a1 = row({
      id: "a1",
      messageId: "<a1@corp-a>",
      threadId: "<a1@corp-a>",
      splitFromThreadId: "<m0@x>",
      inReplyTo: "<m0@x>",
      references: ["<m0@x>"],
      fromAddress: "anna@corp-a.example",
    });
    rows.push(m0, a1);

    // A reply from someone who was in To (no split) replies to the broadcast:
    // unify runs for the broadcast thread and must leave Anna's branch alone.
    await assignThread({
      userId: "u1",
      messageId: "<m2@x>",
      inReplyTo: "<m0@x>",
      references: ["<m0@x>"],
    });

    expect(a1.threadId).toBe("<a1@corp-a>");
    expect(a1.splitFromThreadId).toBe("<m0@x>");
  });
});

describe("repairThreadIds branches (plan 055)", () => {
  it("splits pre-existing replies to a broadcast retroactively, one branch per address", async () => {
    const m0 = row({
      id: "m0",
      messageId: "<m0@x>",
      threadId: "<m0@x>",
      fromAddress: ME,
      toAddresses: [ME],
    });
    const a1 = row({
      id: "a1",
      messageId: "<a1@corp-a>",
      threadId: "<m0@x>",
      inReplyTo: "<m0@x>",
      references: ["<m0@x>"],
      fromAddress: "anna@corp-a.example",
    });
    const b1 = row({
      id: "b1",
      messageId: "<b1@corp-b>",
      threadId: "<m0@x>",
      inReplyTo: "<m0@x>",
      references: ["<m0@x>"],
      fromAddress: "bo@corp-b.example",
    });
    const a2 = row({
      id: "a2",
      messageId: "<a2@corp-a>",
      threadId: "<m0@x>",
      inReplyTo: "<m0@x>",
      references: ["<m0@x>"],
      fromAddress: "ANNA@corp-a.example",
    });
    const s1 = row({
      id: "s1",
      messageId: "<s1@x>",
      threadId: "<m0@x>",
      inReplyTo: "<a1@corp-a>",
      references: ["<m0@x>", "<a1@corp-a>"],
      fromAddress: ME,
      toAddresses: ["anna@corp-a.example"],
    });
    rows.push(m0, a1, b1, a2, s1);

    await repairThreadIds("u1");

    expect(m0).toMatchObject({ threadId: "<m0@x>", splitFromThreadId: null });
    expect(a1).toMatchObject({ threadId: "<a1@corp-a>", splitFromThreadId: "<m0@x>" });
    expect(a2).toMatchObject({ threadId: "<a1@corp-a>", splitFromThreadId: "<m0@x>" });
    expect(s1).toMatchObject({ threadId: "<a1@corp-a>", splitFromThreadId: "<m0@x>" });
    expect(b1).toMatchObject({ threadId: "<b1@corp-b>", splitFromThreadId: "<m0@x>" });
  });

  it("is idempotent with what ingest wrote", async () => {
    rows.push(
      row({
        id: "m0",
        messageId: "<m0@x>",
        threadId: "<m0@x>",
        fromAddress: ME,
        toAddresses: [ME],
      }),
      row({
        id: "a1",
        messageId: "<a1@corp-a>",
        threadId: "<a1@corp-a>",
        splitFromThreadId: "<m0@x>",
        inReplyTo: "<m0@x>",
        references: ["<m0@x>"],
        fromAddress: "anna@corp-a.example",
      }),
      row({
        id: "s1",
        messageId: "<s1@x>",
        threadId: "<a1@corp-a>",
        splitFromThreadId: "<m0@x>",
        inReplyTo: "<a1@corp-a>",
        references: ["<m0@x>", "<a1@corp-a>"],
        fromAddress: ME,
        toAddresses: ["anna@corp-a.example"],
      }),
    );

    await repairThreadIds("u1");

    const { db } = await import("@/lib/db");
    expect(db.message.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a persisted branch root even when a later reply from the same address is older", async () => {
    rows.push(
      row({
        id: "m0",
        messageId: "<m0@x>",
        threadId: "<m0@x>",
        fromAddress: ME,
        toAddresses: [ME],
      }),
      row({
        id: "a1",
        messageId: "<a1@corp-a>",
        threadId: "<a1@corp-a>",
        splitFromThreadId: "<m0@x>",
        inReplyTo: "<m0@x>",
        references: ["<m0@x>"],
        fromAddress: "anna@corp-a.example",
        receivedAt: new Date("2026-02-02T00:00:00Z"),
      }),
    );
    const older = row({
      id: "a0",
      messageId: "<a0@corp-a>",
      threadId: "<m0@x>",
      inReplyTo: "<m0@x>",
      references: ["<m0@x>"],
      fromAddress: "anna@corp-a.example",
      receivedAt: new Date("2026-02-01T00:00:00Z"),
    });
    rows.push(older);

    await repairThreadIds("u1");

    expect(older).toMatchObject({ threadId: "<a1@corp-a>", splitFromThreadId: "<m0@x>" });
  });

  it("leaves group-alias replies threaded with the original", async () => {
    const m0 = row({
      id: "m0",
      messageId: "<m0@x>",
      threadId: "<m0@x>",
      fromAddress: ME,
      toAddresses: ["team@corp.example"],
    });
    const r = row({
      id: "r",
      messageId: "<r@corp>",
      threadId: "<r@corp>",
      inReplyTo: "<m0@x>",
      references: ["<m0@x>"],
      fromAddress: "carl@corp.example",
    });
    rows.push(m0, r);

    await repairThreadIds("u1");

    expect(r).toMatchObject({ threadId: "<m0@x>", splitFromThreadId: null });
  });
});
