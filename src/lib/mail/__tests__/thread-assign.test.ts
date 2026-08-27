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
  inReplyTo: string | null;
  references: string[];
}

let rows: Row[];

type InFilter = { in: string[] };
type Where = {
  userId?: string;
  OR?: Array<{
    messageId?: InFilter;
    threadId?: InFilter;
    inReplyTo?: InFilter;
  }>;
  threadId?: { not: null };
  NOT?: { threadId: string };
  id?: InFilter;
};

function matches(row: Row, where: Where): boolean {
  if (where.userId && row.userId !== where.userId) return false;
  if (where.id && !where.id.in.includes(row.id)) return false;
  if (where.threadId && "not" in where.threadId && row.threadId === null) {
    return false;
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

vi.mock("@/lib/db", () => ({
  db: {
    message: {
      findFirst: vi.fn(async ({ where }: { where: Where }) => {
        return rows.find((r) => matches(r, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: Where }) => {
        return rows.filter((r) => matches(r, where));
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Where;
          data: { threadId: string };
        }) => {
          let count = 0;
          for (const r of rows) {
            if (matches(r, where)) {
              r.threadId = data.threadId;
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
  },
}));

import { assignThreadId, repairThreadIds } from "@/lib/mail/thread-assign";

function row(partial: Partial<Row> & { id: string }): Row {
  return {
    userId: "u1",
    messageId: null,
    threadId: null,
    inReplyTo: null,
    references: [],
    ...partial,
  };
}

beforeEach(() => {
  rows = [];
  vi.clearAllMocks();
});

describe("assignThreadId", () => {
  it("reuses the threadId of a known related message", async () => {
    rows.push(row({ id: "m1", messageId: "<a@x>", threadId: "<t@x>" }));

    const threadId = await assignThreadId({
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

    const threadId = await assignThreadId({
      userId: "u1",
      messageId: "<b@x>",
      inReplyTo: "<a@x>",
      references: ["<a@x>"],
    });

    expect(threadId).toBe("<a@x>");
    expect(anchor.threadId).toBe("<a@x>");
  });

  it("falls back to the message's own Message-ID for a fresh conversation", async () => {
    const threadId = await assignThreadId({
      userId: "u1",
      messageId: "<new@x>",
      inReplyTo: null,
      references: [],
    });

    expect(threadId).toBe("<new@x>");
  });

  it("uses the conversation root from references when no related row exists", async () => {
    const threadId = await assignThreadId({
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

    const threadId = await assignThreadId({
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

    const threadId = await assignThreadId({
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
