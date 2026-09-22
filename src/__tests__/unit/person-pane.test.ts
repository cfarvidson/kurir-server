import { describe, it, expect } from "vitest";
import {
  groupThreadsBySubject,
  recentSubject,
  personEmailFor,
  showsPersonLinks,
  showsPersonPane,
  threadIsDirect,
  visibleRecentThreads,
} from "@/lib/mail/person-pane";

describe("personEmailFor", () => {
  const own = ["Me@Z.com"];

  it("uses the external sender of received mail", () => {
    expect(
      personEmailFor({ fromAddress: "Ada@X.Y", toAddresses: ["me@z.com"] }, own),
    ).toBe("ada@x.y");
  });

  it("falls back to the first external recipient of sent mail", () => {
    expect(
      personEmailFor(
        {
          fromAddress: "me@z.com",
          toAddresses: ["me@z.com", "Bea@X.Y", "cy@x.y"],
        },
        own,
      ),
    ).toBe("bea@x.y");
    expect(
      personEmailFor(
        { fromAddress: "me@z.com", toAddresses: [], ccAddresses: ["cc@x.y"] },
        own,
      ),
    ).toBe("cc@x.y");
  });

  it("gives nothing for notes to self or no row", () => {
    expect(
      personEmailFor({ fromAddress: "me@z.com", toAddresses: ["me@z.com"] }, own),
    ).toBeNull();
    expect(personEmailFor(null, own)).toBeNull();
  });
});

describe("threadIsDirect", () => {
  const own = ["me@z"];

  it("is true for a 1:1 and false when someone else is Cc'd", () => {
    expect(
      threadIsDirect(
        { fromAddress: "a@x.y", toAddresses: ["me@z"], ccAddresses: [] },
        "a@x.y",
        own,
      ),
    ).toBe(true);
    expect(
      threadIsDirect(
        {
          fromAddress: "a@x.y",
          toAddresses: ["me@z"],
          ccAddresses: ["boss@z"],
        },
        "a@x.y",
        own,
      ),
    ).toBe(false);
  });
});

describe("showsPersonPane", () => {
  it("shows on the mail lists, their thread pages and search", () => {
    for (const path of [
      "/imbox",
      "/feed/abc",
      "/paper-trail",
      "/archive/m1",
      "/sent",
      "/snoozed",
    ]) {
      expect(showsPersonPane(path), path).toBe(true);
    }
  });

  it("stays away from pages with no focused row to follow", () => {
    for (const path of [
      "/calendar",
      "/settings",
      "/screener",
      "/compose",
      "/reply-later",
      "/from/ada%40x.y",
      null,
    ]) {
      expect(showsPersonPane(path), String(path)).toBe(false);
    }
  });
});

describe("groupThreadsBySubject", () => {
  it("groups reply/forward variants under the newest thread, in order", () => {
    const threads = [
      { id: "1", subject: "SV: Re: Lunch  plans" },
      { id: "2", subject: "Invoice" },
      { id: "3", subject: "lunch plans" },
      { id: "4", subject: "" },
      { id: "5", subject: "Fwd[2]: RE: Lunch Plans" },
      { id: "6", subject: null },
    ];
    const groups = groupThreadsBySubject(threads, (t) => t.subject);
    expect(groups.map((g) => [g.thread.id, g.count])).toEqual([
      ["1", 3],
      ["2", 1],
      ["4", 1],
      ["6", 1],
    ]);
  });
});

describe("recentSubject", () => {
  it("drops a leading sender name so the distinguishing part shows", () => {
    expect(
      recentSubject(
        "App Store Connect: Version 2026.112 (255)",
        "App Store Connect",
      ),
    ).toBe("Version 2026.112 (255)");
    expect(recentSubject("Lunch?", "App Store Connect")).toBe("Lunch?");
    expect(recentSubject(null, "A")).toBe("(no subject)");
  });
});

describe("visibleRecentThreads", () => {
  const history = ["one", "two", "three", "four"];

  it("does not treat a pending search as the full history or the previous hits", () => {
    expect(
      visibleRecentThreads({
        filtering: true,
        settled: false,
        loaded: ["old hit"],
        baseline: history,
      }),
    ).toEqual({ pending: true, threads: [], cap: false });
  });

  it("keeps the idle list pending until the baseline has landed", () => {
    expect(
      visibleRecentThreads({
        filtering: false,
        settled: false,
        loaded: ["hit"],
        baseline: null,
      }),
    ).toEqual({ pending: true, threads: [], cap: false });
  });

  it("shows every settled hit, and caps the idle list", () => {
    expect(
      visibleRecentThreads({
        filtering: true,
        settled: true,
        loaded: ["hit"],
        baseline: history,
      }),
    ).toEqual({ pending: false, threads: ["hit"], cap: false });
    expect(
      visibleRecentThreads({
        filtering: false,
        settled: false,
        loaded: ["hit"],
        baseline: history,
      }),
    ).toEqual({ pending: false, threads: history, cap: true });
  });
});

describe("showsPersonLinks", () => {
  it("hides links for Feed and Paper Trail senders only", () => {
    expect(showsPersonLinks("IMBOX")).toBe(true);
    expect(showsPersonLinks(null)).toBe(true);
    expect(showsPersonLinks(undefined)).toBe(true);
    expect(showsPersonLinks("FEED")).toBe(false);
    expect(showsPersonLinks("PAPER_TRAIL")).toBe(false);
  });
});
