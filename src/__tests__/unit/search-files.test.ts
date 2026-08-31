import { describe, it, expect, vi, beforeEach } from "vitest";

const attachmentFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    attachment: { findMany: (...args: unknown[]) => attachmentFindMany(...args) },
  },
}));

import {
  fileSearchWhere,
  searchFiles,
  SEARCH_FILES_LIMIT,
} from "@/lib/mail/search-files";

describe("fileSearchWhere", () => {
  it("matches the filename or the sender's name or address, within the user's mail", () => {
    expect(fileSearchWhere("u1", " budget ")).toEqual({
      message: { is: { userId: "u1" } },
      OR: [
        { filename: { contains: "budget", mode: "insensitive" } },
        { message: { is: { fromName: { contains: "budget", mode: "insensitive" } } } },
        { message: { is: { fromAddress: { contains: "budget", mode: "insensitive" } } } },
      ],
    });
  });
});

describe("searchFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    attachmentFindMany.mockResolvedValue([]);
  });

  it("reads newest first, capped, without the blob", async () => {
    await searchFiles("u1", "anna");
    const args = attachmentFindMany.mock.calls[0][0];
    expect(args.where).toEqual(fileSearchWhere("u1", "anna"));
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(args.take).toBe(SEARCH_FILES_LIMIT);
    expect(args.select.content).toBeUndefined();
    expect(args.select.message.select.fromAddress).toBe(true);
  });

  it("skips the query when blank", async () => {
    expect(await searchFiles("u1", " ")).toEqual([]);
    expect(attachmentFindMany).not.toHaveBeenCalled();
  });
});
