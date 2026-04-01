import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getConnectionCredentialsInternal: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {},
}));

vi.mock("imapflow", () => ({
  ImapFlow: vi.fn(),
}));

vi.mock("mailparser", () => ({
  simpleParser: vi.fn(),
}));

vi.mock("@/lib/mail/flag-push", () => ({
  suppressEcho: vi.fn(),
}));

vi.mock("@/lib/mail/imap-client", () => ({
  findArchiveMailbox: vi.fn(),
}));

vi.mock("@/lib/mail/auth-helpers", () => ({
  buildImapAuth: vi.fn(),
}));

import {
  extractAttachmentParts,
  extractDomain,
  createSnippet,
} from "@/lib/mail/sync-service";

describe("extractDomain", () => {
  it("extracts domain from email address", () => {
    expect(extractDomain("user@example.com")).toBe("example.com");
  });

  it("returns full string when no @ present", () => {
    expect(extractDomain("no-at-sign")).toBe("no-at-sign");
  });

  it("handles subdomain emails", () => {
    expect(extractDomain("user@mail.example.com")).toBe("mail.example.com");
  });
});

describe("createSnippet", () => {
  it("returns null for undefined input", () => {
    expect(createSnippet(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(createSnippet("")).toBeNull();
  });

  it("returns cleaned text when shorter than maxLength", () => {
    expect(createSnippet("Hello world")).toBe("Hello world");
  });

  it("truncates long text with ellipsis", () => {
    const long = "A".repeat(200);
    const result = createSnippet(long);
    expect(result).toHaveLength(153); // 150 + "..."
    expect(result!.endsWith("...")).toBe(true);
  });

  it("collapses whitespace", () => {
    expect(createSnippet("hello   \n  world")).toBe("hello world");
  });

  it("strips leading > quote markers from the start of each line", () => {
    // \s+/g runs first, collapsing newlines to spaces, producing one line.
    // Then /^[\s>]+/gm strips the leading "> " from that single line.
    // The mid-string " > " is not at a line boundary so it stays.
    expect(createSnippet("> quoted text\n> more")).toBe("quoted text > more");
  });

  it("respects custom maxLength", () => {
    const result = createSnippet("Hello world, this is a test", 10);
    expect(result).toBe("Hello worl...");
  });
});

describe("extractAttachmentParts", () => {
  it("returns empty array for a plain text node", () => {
    const node = { type: "text", subtype: "plain", size: 100 };
    expect(extractAttachmentParts(node)).toEqual([]);
  });

  it("extracts attachment by disposition", () => {
    const node = {
      type: "application",
      subtype: "pdf",
      disposition: "attachment",
      dispositionParameters: { filename: "doc.pdf" },
      size: 5000,
    };
    const result = extractAttachmentParts(node);
    expect(result).toEqual([
      { partId: "1", type: "application/pdf", filename: "doc.pdf", size: 5000 },
    ]);
  });

  it("extracts attachment by filename (no disposition)", () => {
    const node = {
      type: "image",
      subtype: "png",
      parameters: { name: "photo.png" },
      size: 3000,
    };
    const result = extractAttachmentParts(node);
    expect(result).toEqual([
      { partId: "1", type: "image/png", filename: "photo.png", size: 3000 },
    ]);
  });

  it("extracts inline images (non-text inline)", () => {
    const node = {
      type: "image",
      subtype: "jpeg",
      disposition: "inline",
      size: 2000,
    };
    const result = extractAttachmentParts(node);
    expect(result).toEqual([
      { partId: "1", type: "image/jpeg", filename: "", size: 2000 },
    ]);
  });

  it("skips inline text parts", () => {
    const node = {
      type: "text",
      subtype: "html",
      disposition: "inline",
      size: 500,
    };
    expect(extractAttachmentParts(node)).toEqual([]);
  });

  it("walks nested multipart structures", () => {
    const node = {
      childNodes: [
        { type: "text", subtype: "plain", size: 100 },
        {
          childNodes: [
            { type: "text", subtype: "html", size: 200 },
            {
              type: "application",
              subtype: "pdf",
              disposition: "attachment",
              dispositionParameters: { filename: "report.pdf" },
              size: 10000,
            },
          ],
        },
        {
          type: "image",
          subtype: "png",
          disposition: "inline",
          size: 5000,
        },
      ],
    };
    const result = extractAttachmentParts(node);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      partId: "2.2",
      type: "application/pdf",
      filename: "report.pdf",
    });
    expect(result[1]).toMatchObject({
      partId: "3",
      type: "image/png",
    });
  });

  it("defaults size to 0 when not provided", () => {
    const node = {
      type: "application",
      subtype: "zip",
      disposition: "attachment",
      dispositionParameters: { filename: "archive.zip" },
    };
    const result = extractAttachmentParts(node);
    expect(result[0].size).toBe(0);
  });
});
