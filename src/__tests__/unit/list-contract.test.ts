import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  threadCountLabel,
  primaryLine,
  listActionSet,
  emptyCopy,
  showsSections,
  showsSearch,
  searchCategoryFilter,
  searchActionProps,
  uniqueBlockSenderIds,
  bulkReadMarksRead,
  swipeActions,
} from "@/lib/mail/list-contract";

describe("threadCountLabel", () => {
  it("returns ·N only when count is greater than 1", () => {
    expect(threadCountLabel(undefined)).toBeNull();
    expect(threadCountLabel(1)).toBeNull();
    expect(threadCountLabel(4)).toBe("·4");
  });
});

describe("primaryLine", () => {
  it("uses displayName then fromName then fromAddress on inbound lists", () => {
    expect(
      primaryLine({
        list: "imbox",
        displayName: "Ada",
        fromName: "A. Lovelace",
        fromAddress: "ada@x.y",
      }),
    ).toBe("Ada");
  });

  it("uses To: addresses on Sent, then Cc, then Bcc only", () => {
    expect(
      primaryLine({
        list: "sent",
        fromAddress: "me@x.y",
        toAddresses: ["ada@x.y", "al@x.y"],
      }),
    ).toBe("To: ada@x.y, al@x.y");
    expect(
      primaryLine({
        list: "sent",
        fromAddress: "me@x.y",
        toAddresses: [],
        cc: "cc@x.y",
      }),
    ).toBe("Cc: cc@x.y");
    expect(
      primaryLine({
        list: "sent",
        fromAddress: "me@x.y",
        toAddresses: [],
      }),
    ).toBe("Bcc only");
  });
});

describe("listActionSet", () => {
  it("matches the spec matrix", () => {
    expect(listActionSet("imbox")).toEqual({
      followUp: true,
      snooze: true,
      archive: true,
      unarchive: false,
    });
    expect(listActionSet("follow-up")).toEqual({
      followUp: true,
      snooze: false,
      archive: true,
      unarchive: false,
    });
    expect(listActionSet("sent")).toEqual({
      followUp: true,
      snooze: false,
      archive: false,
      unarchive: false,
    });
    expect(listActionSet("archive")).toEqual({
      followUp: true,
      snooze: false,
      archive: false,
      unarchive: true,
    });
    expect(listActionSet("reply-later")).toEqual({
      followUp: false,
      snooze: false,
      archive: false,
      unarchive: false,
    });
  });
});

describe("emptyCopy", () => {
  it("uses the web strings from the spec table", () => {
    expect(emptyCopy("imbox")).toEqual({
      title: "Your Imbox is empty",
      description:
        "Approve senders in the Screener to see their emails here.",
    });
    expect(emptyCopy("reply-later")).toEqual({
      title: "All caught up",
      description: "Nothing left to reply to. Nice work.",
    });
  });
});

describe("showsSections / showsSearch", () => {
  it("sections only the three main lists", () => {
    expect(showsSections("imbox")).toBe(true);
    expect(showsSections("archive")).toBe(false);
    expect(showsSections("reply-later")).toBe(false);
  });

  it("search on seven lists, not Reply Later", () => {
    expect(showsSearch("imbox")).toBe(true);
    expect(showsSearch("sent")).toBe(true);
    expect(showsSearch("reply-later")).toBe(false);
  });
});

describe("searchActionProps", () => {
  it("maps Archive search to follow-up + unarchive", () => {
    expect(searchActionProps("archive")).toEqual({
      showFollowUpAction: true,
      showSnoozeAction: false,
      showArchiveAction: false,
      showUnarchiveAction: true,
    });
  });

  it("maps Imbox search to follow-up, snooze, and archive", () => {
    expect(searchActionProps("imbox")).toEqual({
      showFollowUpAction: true,
      showSnoozeAction: true,
      showArchiveAction: true,
      showUnarchiveAction: false,
    });
  });

  it("maps Sent search to follow-up only", () => {
    expect(searchActionProps("sent")).toEqual({
      showFollowUpAction: true,
      showSnoozeAction: false,
      showArchiveAction: false,
      showUnarchiveAction: false,
    });
  });
});

describe("searchCategoryFilter", () => {
  it("returns empty SQL when category is omitted", () => {
    expect(searchCategoryFilter(null)).toEqual(Prisma.empty);
  });

  it("adds isReplyLater = false on the three main lists", () => {
    const sql = searchCategoryFilter("imbox").strings.join("");
    expect(sql).toContain('"isInImbox" = true');
    expect(sql).toContain('"isSnoozed" = false');
    expect(sql).toContain('"isReplyLater" = false');
  });

  it("filters Sent via the sent folder specialUse", () => {
    const sql = searchCategoryFilter("sent").strings.join("");
    expect(sql).toContain('"specialUse"');
    expect(sql).toContain("sent");
  });
});

describe("uniqueBlockSenderIds", () => {
  it("drops own addresses and duplicates, keeps order", () => {
    const own = (email: string) => email === "me@x.y";
    expect(
      uniqueBlockSenderIds(
        [
          { senderId: "s1", fromAddress: "ada@x.y" },
          { senderId: "s1", fromAddress: "ada@x.y" },
          { senderId: "s2", fromAddress: "me@x.y" },
          { senderId: null, fromAddress: "al@x.y" },
        ],
        own,
      ),
    ).toEqual(["s1"]);
  });
});

describe("bulkReadMarksRead", () => {
  it("is true when any selected row is unread", () => {
    expect(bulkReadMarksRead([{ isRead: true }, { isRead: false }])).toBe(
      true,
    );
    expect(bulkReadMarksRead([{ isRead: true }])).toBe(false);
  });
});

describe("swipeActions", () => {
  it("maps leading read and trailing archive/unarchive per list", () => {
    expect(swipeActions("imbox")).toEqual({
      leading: "read",
      trailing: "archive",
    });
    expect(swipeActions("archive")).toEqual({
      leading: "read",
      trailing: "unarchive",
    });
    expect(swipeActions("sent")).toEqual({
      leading: "read",
      trailing: null,
    });
    expect(swipeActions("reply-later")).toEqual({
      leading: null,
      trailing: null,
    });
  });
});
