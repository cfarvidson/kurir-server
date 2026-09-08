import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Branch threads in the detail query (plan 055): a branch anchor renders only
 * its threadId rows, a broadcast anchor never links branch rows in, and
 * branchesOf / splitOriginOf describe the two sides of a split.
 *
 * The db mock is an in-memory store implementing the where shapes
 * getThreadMessages / branchesOf / splitOriginOf issue.
 */

interface Row {
  id: string;
  userId: string;
  uid: number;
  folderId: string;
  messageId: string | null;
  threadId: string | null;
  splitFromThreadId: string | null;
  inReplyTo: string | null;
  references: string[];
  fromAddress: string;
  fromName: string | null;
  isRead: boolean;
  sentAt: Date | null;
  receivedAt: Date;
  isInImbox: boolean;
  isInFeed: boolean;
  isInPaperTrail: boolean;
  isArchived: boolean;
  sender: { unthread: boolean; displayName: string | null } | null;
}

let rows: Row[];

type Where = Record<string, unknown>;

function matchClause(row: Row, where: Where): boolean {
  for (const [field, cond] of Object.entries(where)) {
    if (field === "OR") {
      const any = (cond as Where[]).some((c) => matchClause(row, c));
      if (!any) return false;
      continue;
    }
    const value = (row as unknown as Record<string, unknown>)[field];
    if (cond !== null && typeof cond === "object") {
      const c = cond as { in?: unknown[]; notIn?: unknown[] };
      if (c.in && !c.in.includes(value)) return false;
      if (c.notIn && c.notIn.includes(value)) return false;
      continue;
    }
    if ((value ?? null) !== (cond ?? null)) return false;
  }
  return true;
}

function ordered(list: Row[], orderBy?: { receivedAt?: "asc" }) {
  if (!orderBy?.receivedAt) return list;
  return [...list].sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
  );
}

vi.mock("@/lib/mail/push-sender", () => ({
  nudgeIosClients: vi.fn(),
  pushToUser: vi.fn(),
}));

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
        }) =>
          ordered(
            rows.filter((r) => matchClause(r, where)),
            orderBy,
          )[0] ?? null,
      ),
      findMany: vi.fn(
        async ({
          where,
          orderBy,
        }: {
          where: Where;
          orderBy?: { receivedAt?: "asc" };
        }) => ordered(rows.filter((r) => matchClause(r, where)), orderBy),
      ),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

import {
  getThreadMessages,
  branchesOf,
  splitOriginOf,
} from "@/lib/mail/threads";

let seq = 0;
function row(partial: Partial<Row> & { id: string }): Row {
  seq += 1;
  return {
    userId: "u1",
    uid: seq,
    folderId: "inbox",
    messageId: null,
    threadId: null,
    splitFromThreadId: null,
    inReplyTo: null,
    references: [],
    fromAddress: "someone@else.example",
    fromName: null,
    isRead: true,
    sentAt: null,
    receivedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)),
    isInImbox: true,
    isInFeed: false,
    isInPaperTrail: false,
    isArchived: false,
    sender: null,
    ...partial,
  };
}

const ME = "me@mine.example";

function seedSplit() {
  const m0 = row({
    id: "m0",
    messageId: "<m0@x>",
    threadId: "<m0@x>",
    fromAddress: ME,
    isInImbox: false,
  });
  const a1 = row({
    id: "a1",
    messageId: "<a1@corp-a>",
    threadId: "<a1@corp-a>",
    splitFromThreadId: "<m0@x>",
    inReplyTo: "<m0@x>",
    references: ["<m0@x>"],
    fromAddress: "anna@corp-a.example",
    sender: { unthread: false, displayName: "Corp A" },
  });
  const s1 = row({
    id: "s1",
    messageId: "<s1@x>",
    threadId: "<a1@corp-a>",
    splitFromThreadId: "<m0@x>",
    inReplyTo: "<a1@corp-a>",
    references: ["<m0@x>", "<a1@corp-a>"],
    fromAddress: ME,
    isInImbox: false,
  });
  const b1 = row({
    id: "b1",
    messageId: "<b1@corp-b>",
    threadId: "<b1@corp-b>",
    splitFromThreadId: "<m0@x>",
    inReplyTo: "<m0@x>",
    references: ["<m0@x>"],
    fromAddress: "bo@corp-b.example",
    fromName: "Bo",
  });
  rows.push(m0, a1, s1, b1);
  return { m0, a1, s1, b1 };
}

beforeEach(() => {
  rows = [];
  vi.clearAllMocks();
});

describe("getThreadMessages with branches", () => {
  it("renders a branch as exactly its threadId rows", async () => {
    seedSplit();

    const result = await getThreadMessages("u1", "s1");

    expect(result?.messages.map((m) => m.id)).toEqual(["a1", "s1"]);
  });

  it("never links branch rows into the broadcast thread", async () => {
    seedSplit();

    const result = await getThreadMessages("u1", "m0");

    expect(result?.messages.map((m) => m.id)).toEqual(["m0"]);
  });

  it("still links a visible-recipient reply into the original thread", async () => {
    seedSplit();
    rows.push(
      row({
        id: "t1",
        messageId: "<t1@corp>",
        threadId: "<t1@corp>",
        inReplyTo: "<m0@x>",
        references: ["<m0@x>"],
        fromAddress: "team@corp.example",
      }),
    );

    const result = await getThreadMessages("u1", "m0");

    expect(result?.messages.map((m) => m.id)).toEqual(["m0", "t1"]);
  });
});

describe("branchesOf", () => {
  it("lists one branch per counterpart, oldest first, with a route to the latest row", async () => {
    seedSplit();

    const branches = await branchesOf("u1", "<m0@x>");

    expect(branches).toEqual([
      expect.objectContaining({
        threadId: "<a1@corp-a>",
        senderName: "Corp A",
        count: 2,
        href: "/imbox/s1",
        rootInReplyTo: "<m0@x>",
      }),
      expect.objectContaining({
        threadId: "<b1@corp-b>",
        senderName: "Bo",
        count: 1,
        href: "/imbox/b1",
      }),
    ]);
  });

  it("is empty for a thread that never split", async () => {
    seedSplit();
    expect(await branchesOf("u1", "<a1@corp-a>")).toEqual([]);
  });
});

describe("splitOriginOf", () => {
  it("points a branch back at the broadcast message", async () => {
    const { a1, s1 } = seedSplit();

    const origin = await splitOriginOf("u1", [a1, s1]);

    expect(origin).toEqual({ href: "/imbox/m0", sentAt: expect.any(Date) });
  });

  it("is null outside branches", async () => {
    const { m0 } = seedSplit();
    expect(await splitOriginOf("u1", [m0])).toBeNull();
  });
});
