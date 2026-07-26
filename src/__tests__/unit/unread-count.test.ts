import { describe, it, expect } from "vitest";
import { countUnreadThreads } from "@/lib/mail/unread-count";

describe("countUnreadThreads", () => {
  it("collapses multiple unread rows in the same thread to 1", () => {
    const rows = [
      { id: "m1", threadId: "t1", unthread: false },
      { id: "m2", threadId: "t1", unthread: false },
    ];
    expect(countUnreadThreads(rows)).toBe(1);
  });

  it("counts unread rows in different threads as n", () => {
    const rows = [
      { id: "m1", threadId: "t1", unthread: false },
      { id: "m2", threadId: "t2", unthread: false },
      { id: "m3", threadId: "t3", unthread: false },
    ];
    expect(countUnreadThreads(rows)).toBe(3);
  });

  it("counts unthread rows individually even when they share a threadId", () => {
    const rows = [
      { id: "m1", threadId: "t1", unthread: true },
      { id: "m2", threadId: "t1", unthread: true },
    ];
    expect(countUnreadThreads(rows)).toBe(2);
  });

  it("falls back to id when threadId is null", () => {
    const rows = [
      { id: "m1", threadId: null, unthread: false },
      { id: "m2", threadId: null, unthread: false },
    ];
    expect(countUnreadThreads(rows)).toBe(2);
  });

  it("returns 0 for an empty list", () => {
    expect(countUnreadThreads([])).toBe(0);
  });
});
