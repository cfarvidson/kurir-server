import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    attachment: {
      findMany: vi.fn(),
    },
  },
}));

import { getFiles, encodeFileCursor, parseFileCursor } from "../files";
import { db } from "@/lib/db";

function makeRow(i: number) {
  return {
    id: `c${"a".repeat(24)}${i}`,
    filename: `file-${i}.pdf`,
    contentType: "application/pdf",
    size: 1000,
    createdAt: new Date(2026, 0, i + 1),
    message: {
      id: `m${i}`,
      subject: "Subject",
      receivedAt: new Date(2026, 0, i + 1),
      fromName: "Alice",
      fromAddress: "alice@example.com",
    },
  };
}

describe("getFiles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes the query to the user's own messages", async () => {
    vi.mocked(db.attachment.findMany).mockResolvedValue([] as never);
    await getFiles("user-1");
    const arg = vi.mocked(db.attachment.findMany).mock.calls[0][0];
    expect(arg?.where).toMatchObject({ message: { is: { userId: "user-1" } } });
  });

  it("adds a content-type filter when a group is given", async () => {
    vi.mocked(db.attachment.findMany).mockResolvedValue([] as never);
    await getFiles("user-1", { group: "image" });
    const arg = vi.mocked(db.attachment.findMany).mock.calls[0][0];
    expect(JSON.stringify(arg?.where)).toContain("image/");
  });

  it("adds a case-insensitive filename filter when q is given", async () => {
    vi.mocked(db.attachment.findMany).mockResolvedValue([] as never);
    await getFiles("user-1", { q: "invoice" });
    const arg = vi.mocked(db.attachment.findMany).mock.calls[0][0];
    expect(arg?.where?.filename).toMatchObject({
      contains: "invoice",
      mode: "insensitive",
    });
  });

  it("returns a nextCursor only when a full page is returned", async () => {
    const rows = Array.from({ length: 2 }, (_, i) => makeRow(i));
    vi.mocked(db.attachment.findMany).mockResolvedValue(rows as never);

    const full = await getFiles("user-1", { limit: 2 });
    expect(full?.nextCursor).not.toBeNull();

    vi.mocked(db.attachment.findMany).mockResolvedValue([makeRow(0)] as never);
    const partial = await getFiles("user-1", { limit: 2 });
    expect(partial?.nextCursor).toBeNull();
  });

  it("returns null for a malformed cursor", async () => {
    const result = await getFiles("user-1", { cursor: "not-a-cursor" });
    expect(result).toBeNull();
    expect(db.attachment.findMany).not.toHaveBeenCalled();
  });

  it("round-trips a valid cursor", () => {
    const file = { createdAt: new Date("2026-01-15T00:00:00.000Z"), id: `c${"a".repeat(24)}` };
    const parsed = parseFileCursor(encodeFileCursor(file));
    expect(parsed).not.toBeNull();
  });
});
