import { describe, it, expect } from "vitest";
import {
  presentDraft,
  draftFolderFromMessage,
  draftCatalogHref,
  pickReplyDraftForThread,
  replyDraftSubject,
} from "@/lib/mail/draft-presentation";

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
