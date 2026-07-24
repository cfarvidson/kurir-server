import { describe, it, expect } from "vitest";
import {
  selectImboxPushes,
  type ImboxPushMessage,
} from "@/lib/mail/push-select";

function msg(overrides: Partial<ImboxPushMessage> = {}): ImboxPushMessage {
  return {
    id: "m1",
    fromName: "Alice",
    fromAddress: "alice@example.com",
    subject: "Hello",
    threadId: null,
    ...overrides,
  };
}

function folderResult(newImboxMessages: ImboxPushMessage[]) {
  return {
    folderId: "f1",
    folderPath: "INBOX",
    newMessages: newImboxMessages.length,
    errors: [],
    remaining: 0,
    totalOnServer: 0,
    totalCached: 0,
    newImboxMessages,
  };
}

describe("selectImboxPushes", () => {
  it("returns imbox messages collected across all folder results", () => {
    const a = msg({ id: "a" });
    const b = msg({ id: "b" });
    const picked = selectImboxPushes([folderResult([a]), folderResult([b])]);
    expect(picked).toEqual([a, b]);
  });

  it("returns empty array when no folder produced imbox messages", () => {
    expect(selectImboxPushes([folderResult([])])).toEqual([]);
  });

  it("dedupes messages in the same thread, keeping the newest (last processed)", () => {
    const older = msg({ id: "old", threadId: "t1", subject: "First" });
    const newer = msg({ id: "new", threadId: "t1", subject: "Re: First" });
    const picked = selectImboxPushes([folderResult([older, newer])]);
    expect(picked).toEqual([newer]);
  });

  it("treats messages without threadId as separate threads keyed by id", () => {
    const a = msg({ id: "a", threadId: null });
    const b = msg({ id: "b", threadId: null });
    expect(selectImboxPushes([folderResult([a, b])])).toHaveLength(2);
  });
});
