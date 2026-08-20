import { describe, it, expect } from "vitest";
import { fileOpenHref } from "@/lib/mail/files";

describe("fileOpenHref", () => {
  it("joins getThreadRoute with the message id", () => {
    expect(
      fileOpenHref({
        id: "m1",
        isInImbox: false,
        isInFeed: true,
        isInPaperTrail: false,
        isArchived: false,
      }),
    ).toBe("/feed/m1");
  });

  it("returns null without a message", () => {
    expect(fileOpenHref(null)).toBeNull();
  });
});
