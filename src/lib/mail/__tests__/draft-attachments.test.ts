import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    attachment: { findMany: vi.fn() },
    draft: { upsert: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { db } from "@/lib/db";
import { loadAttachmentMeta } from "@/lib/mail/drafts";

describe("loadAttachmentMeta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty list when no ids are given", async () => {
    expect(await loadAttachmentMeta("u1", [])).toEqual([]);
    expect(db.attachment.findMany).not.toHaveBeenCalled();
  });

  it("returns filename, contentType, size, and url in the requested order", async () => {
    vi.mocked(db.attachment.findMany).mockResolvedValue([
      {
        id: "b",
        filename: "cv.pdf",
        contentType: "application/pdf",
        size: 12_345,
      },
      {
        id: "a",
        filename: "note.txt",
        contentType: "text/plain",
        size: 20,
      },
    ] as never);

    const rows = await loadAttachmentMeta("u1", ["a", "b"]);
    expect(rows).toEqual([
      {
        id: "a",
        filename: "note.txt",
        contentType: "text/plain",
        size: 20,
        url: "/api/attachments/a",
      },
      {
        id: "b",
        filename: "cv.pdf",
        contentType: "application/pdf",
        size: 12345,
        url: "/api/attachments/b",
      },
    ]);
  });

  it("does not invent a 0-byte Attachment chip for a missing id", async () => {
    vi.mocked(db.attachment.findMany).mockResolvedValue([] as never);
    expect(await loadAttachmentMeta("u1", ["gone"])).toEqual([]);
  });
});
