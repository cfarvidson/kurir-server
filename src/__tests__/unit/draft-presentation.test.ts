import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mail/drafts", () => ({
  listDraftsForUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    message: { findMany: vi.fn(), findFirst: vi.fn() },
    draft: { findMany: vi.fn() },
  },
}));

import { listDraftsForUser } from "@/lib/mail/drafts";
import { db } from "@/lib/db";
import {
  presentDraft,
  draftFolderFromMessage,
  draftCatalogHref,
  pickReplyDraftForThread,
  replyDraftSubject,
  CONTEXT_MESSAGE_ID_ERROR,
} from "@/lib/mail/draft-presentation";
import {
  presentDraftsForUser,
  findReplyDraftForThread,
  loadDraftContextMessage,
  prepareDraftSave,
} from "@/lib/mail/draft-presentation-db";

const feedMsg = {
  subject: "Q3 budget",
  fromName: "Ada Lovelace",
  fromAddress: "ada@x.y",
  isInImbox: false,
  isInFeed: true,
  isInPaperTrail: false,
  isArchived: false,
};

describe("presentDraft", () => {
  it("uses original subject and from when reply subject is empty", () => {
    expect(
      presentDraft({ type: "REPLY", subject: "  " }, feedMsg),
    ).toEqual({
      displaySubject: "Q3 budget",
      displayFrom: "Ada Lovelace",
      folder: "feed",
    });
  });

  it("lets a non-empty draft subject win", () => {
    expect(
      presentDraft({ type: "REPLY", subject: "My take" }, feedMsg)
        .displaySubject,
    ).toBe("My take");
  });

  it("falls back to fromAddress when name is missing", () => {
    expect(
      presentDraft(
        { type: "REPLY", subject: "" },
        { ...feedMsg, fromName: null },
      ).displayFrom,
    ).toBe("ada@x.y");
  });

  it("returns null from and folder for an orphan reply", () => {
    expect(presentDraft({ type: "REPLY", subject: "" }, null)).toEqual({
      displaySubject: "",
      displayFrom: null,
      folder: null,
    });
  });

  it("does not set displayFrom on NEW or FORWARD", () => {
    expect(
      presentDraft({ type: "NEW", subject: "Hi" }, null).displayFrom,
    ).toBeNull();
    expect(
      presentDraft({ type: "FORWARD", subject: "Hi" }, feedMsg).displayFrom,
    ).toBeNull();
  });
});

describe("draftFolderFromMessage", () => {
  it("follows getThreadRoute flags", () => {
    const base = {
      isInImbox: false,
      isInFeed: false,
      isInPaperTrail: false,
      isArchived: false,
    };
    expect(draftFolderFromMessage({ ...base, isInImbox: true })).toBe("imbox");
    expect(draftFolderFromMessage({ ...base, isInFeed: true })).toBe("feed");
    expect(
      draftFolderFromMessage({ ...base, isInPaperTrail: true }),
    ).toBe("paper-trail");
    expect(draftFolderFromMessage({ ...base, isArchived: true })).toBe(
      "archive",
    );
    expect(draftFolderFromMessage(base)).toBe("imbox");
  });
});

describe("draftCatalogHref", () => {
  it("opens a reply on the folder thread", () => {
    expect(
      draftCatalogHref({
        type: "REPLY",
        contextMessageId: "msg-1",
        folder: "feed",
      }),
    ).toBe("/feed/msg-1");
  });

  it("opens an orphan reply as detached compose", () => {
    expect(
      draftCatalogHref({
        type: "REPLY",
        contextMessageId: "msg-1",
        folder: null,
      }),
    ).toBe("/compose?draftType=REPLY&draft=msg-1&from=/drafts");
  });

  it("keeps NEW and FORWARD on compose", () => {
    expect(
      draftCatalogHref({
        type: "NEW",
        contextMessageId: "uuid-1",
        folder: null,
      }),
    ).toBe("/compose?draft=uuid-1&from=/drafts");
    expect(
      draftCatalogHref({
        type: "FORWARD",
        contextMessageId: "msg-1",
        folder: "imbox",
      }),
    ).toBe("/compose?forward=msg-1&from=/drafts");
  });
});

describe("pickReplyDraftForThread", () => {
  it("returns the newest REPLY in the thread", () => {
    const older = {
      type: "REPLY",
      contextMessageId: "m1",
      updatedAt: new Date("2026-08-01T00:00:00Z"),
    };
    const newer = {
      type: "REPLY",
      contextMessageId: "m2",
      updatedAt: new Date("2026-08-02T00:00:00Z"),
    };
    const other = {
      type: "REPLY",
      contextMessageId: "other",
      updatedAt: new Date("2026-08-03T00:00:00Z"),
    };
    expect(
      pickReplyDraftForThread([older, newer, other], ["m1", "m2"])
        ?.contextMessageId,
    ).toBe("m2");
  });

  it("returns null when the thread has no reply draft", () => {
    expect(
      pickReplyDraftForThread(
        [
          {
            type: "NEW",
            contextMessageId: "m1",
            updatedAt: new Date(),
          },
        ],
        ["m1"],
      ),
    ).toBeNull();
  });
});

describe("replyDraftSubject", () => {
  it("keeps a saved subject and otherwise copies the original as-is", () => {
    expect(replyDraftSubject("My take", "Q3 budget")).toBe("My take");
    expect(replyDraftSubject("  ", "Q3 budget")).toBe("Q3 budget");
    expect(replyDraftSubject(undefined, "Re: Hi")).toBe("Re: Hi");
  });
});

describe("presentDraftsForUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("joins context messages and attaches display fields", async () => {
    vi.mocked(listDraftsForUser).mockResolvedValue([
      {
        id: "d1",
        type: "REPLY",
        contextMessageId: "m1",
        subject: "",
        to: "ada@x.y",
        body: "hi",
        updatedAt: new Date("2026-08-02T00:00:00Z"),
      },
    ] as never);
    vi.mocked(db.message.findMany).mockResolvedValue([
      {
        id: "m1",
        subject: "Q3 budget",
        fromName: "Ada Lovelace",
        fromAddress: "ada@x.y",
        isInImbox: false,
        isInFeed: true,
        isInPaperTrail: false,
        isArchived: false,
      },
    ] as never);

    const rows = await presentDraftsForUser("u1");
    expect(db.message.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", id: { in: ["m1"] } },
      select: {
        id: true,
        subject: true,
        fromName: true,
        fromAddress: true,
        isInImbox: true,
        isInFeed: true,
        isInPaperTrail: true,
        isArchived: true,
      },
    });
    expect(rows[0]).toMatchObject({
      displaySubject: "Q3 budget",
      displayFrom: "Ada Lovelace",
      folder: "feed",
    });
  });
});

describe("findReplyDraftForThread", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null for an empty id list without querying", async () => {
    expect(await findReplyDraftForThread("u1", [])).toBeNull();
    expect(db.draft.findMany).not.toHaveBeenCalled();
  });

  it("asks for the newest REPLY in the id set", async () => {
    vi.mocked(db.draft.findMany).mockResolvedValue([
      { id: "d2", contextMessageId: "m2" },
    ] as never);
    const row = await findReplyDraftForThread("u1", ["m1", "m2"]);
    expect(db.draft.findMany).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        type: "REPLY",
        contextMessageId: { in: ["m1", "m2"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 1,
    });
    expect(row?.contextMessageId).toBe("m2");
  });
});

describe("loadDraftContextMessage", () => {
  it("returns null when the message is not the user's", async () => {
    vi.mocked(db.message.findFirst).mockResolvedValue(null);
    expect(await loadDraftContextMessage("u1", "th-not-a-message")).toBeNull();
  });
});

describe("prepareDraftSave", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects REPLY when the context is not an owned message", async () => {
    vi.mocked(db.message.findFirst).mockResolvedValue(null);
    const result = await prepareDraftSave("u1", {
      type: "REPLY",
      contextMessageId: "th-thread-id",
    });
    expect(result).toEqual({
      ok: false,
      message: CONTEXT_MESSAGE_ID_ERROR,
    });
  });

  it("fills subject and connection from the original message", async () => {
    const message = {
      id: "m1",
      subject: "Q3 budget",
      fromName: "Ada",
      fromAddress: "ada@x.y",
      isInImbox: true,
      isInFeed: false,
      isInPaperTrail: false,
      isArchived: false,
      emailConnectionId: "conn-1",
    };
    vi.mocked(db.message.findFirst).mockResolvedValue(message as never);
    const result = await prepareDraftSave("u1", {
      type: "REPLY",
      contextMessageId: "m1",
      body: "hello",
    });
    expect(result).toEqual({
      ok: true,
      input: {
        type: "REPLY",
        contextMessageId: "m1",
        body: "hello",
        subject: "Q3 budget",
        emailConnectionId: "conn-1",
      },
      message,
    });
  });
});
