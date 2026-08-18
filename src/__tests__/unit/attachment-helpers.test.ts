import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    attachment: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  getConnectionCredentialsInternal: vi.fn(),
}));

import { db } from "@/lib/db";
import { loadAttachmentsForSend } from "@/lib/mail/attachment-helpers";

describe("loadAttachmentsForSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not send a 0-byte file when stored content is an empty Buffer", async () => {
    vi.mocked(db.attachment.findMany).mockResolvedValue([
      {
        id: "att-1",
        filename: "invoice.pdf",
        contentType: "application/pdf",
        size: 0,
        content: Buffer.alloc(0),
        partId: null,
        message: null,
      },
    ] as never);

    await expect(
      loadAttachmentsForSend(["att-1"], "u1"),
    ).rejects.toThrow(/not available/i);
  });
});
