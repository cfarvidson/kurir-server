import { describe, it, expect } from "vitest";
import { collapseToThreads } from "@/lib/mail/threads";

describe("collapseToThreads", () => {
  it("returns empty array for empty input", () => {
    expect(collapseToThreads([])).toEqual([]);
  });

  it("passes through single message with no threadId", () => {
    const messages = [{ id: "m1", threadId: null, isRead: true }];
    const result = collapseToThreads(messages);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m1");
  });

  it("collapses messages with the same threadId to the first occurrence", () => {
    const messages = [
      { id: "m3", threadId: "t1", isRead: true },
      { id: "m2", threadId: "t1", isRead: true },
      { id: "m1", threadId: "t1", isRead: true },
    ];
    const result = collapseToThreads(messages);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m3");
  });

  it("propagates unread status to the representative message", () => {
    const messages = [
      { id: "m2", threadId: "t1", isRead: true },
      { id: "m1", threadId: "t1", isRead: false },
    ];
    const result = collapseToThreads(messages);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m2");
    expect(result[0].isRead).toBe(false);
  });

  it("does not modify already-unread representative", () => {
    const messages = [
      { id: "m2", threadId: "t1", isRead: false },
      { id: "m1", threadId: "t1", isRead: true },
    ];
    const result = collapseToThreads(messages);
    expect(result).toHaveLength(1);
    expect(result[0].isRead).toBe(false);
  });

  it("keeps messages with null threadId as separate entries", () => {
    const messages = [
      { id: "m1", threadId: null, isRead: true },
      { id: "m2", threadId: null, isRead: false },
    ];
    const result = collapseToThreads(messages);
    expect(result).toHaveLength(2);
  });

  it("handles mix of threaded and non-threaded messages", () => {
    const messages = [
      { id: "m4", threadId: "t1", isRead: true },
      { id: "m3", threadId: null, isRead: true },
      { id: "m2", threadId: "t1", isRead: true },
      { id: "m1", threadId: "t2", isRead: false },
    ];
    const result = collapseToThreads(messages);
    expect(result).toHaveLength(3);
    expect(result.map((m) => m.id)).toEqual(["m4", "m3", "m1"]);
  });

  it("preserves extra properties on messages", () => {
    const messages = [
      { id: "m1", threadId: null, isRead: true, subject: "Hello", extra: 42 },
    ];
    const result = collapseToThreads(messages);
    expect(result[0]).toMatchObject({ subject: "Hello", extra: 42 });
  });

  it("does not collapse messages whose sender is flagged unthread", () => {
    const messages = [
      {
        id: "m2",
        threadId: "t1",
        isRead: true,
        sender: { unthread: true },
      },
      {
        id: "m1",
        threadId: "t1",
        isRead: true,
        sender: { unthread: true },
      },
    ];
    const result = collapseToThreads(messages);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(["m2", "m1"]);
  });

  it("mixes threaded and unthreaded senders in one list", () => {
    const messages = [
      // unthreaded sender — both kept
      { id: "u2", threadId: "tA", isRead: true, sender: { unthread: true } },
      { id: "u1", threadId: "tA", isRead: false, sender: { unthread: true } },
      // normal thread — collapsed to one
      { id: "n2", threadId: "tB", isRead: true, sender: { unthread: false } },
      { id: "n1", threadId: "tB", isRead: false, sender: { unthread: false } },
    ];
    const result = collapseToThreads(messages);
    expect(result.map((m) => m.id)).toEqual(["u2", "u1", "n2"]);
    // unread propagated to the collapsed normal thread representative
    expect(result.find((m) => m.id === "n2")?.isRead).toBe(false);
  });
});
