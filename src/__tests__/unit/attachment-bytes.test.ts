import { describe, it, expect } from "vitest";
import {
  decodeUploadedAttachmentData,
  storedContentToBuffer,
} from "@/lib/mail/attachment-bytes";

describe("decodeUploadedAttachmentData", () => {
  it("decodes standard base64", () => {
    const bytes = decodeUploadedAttachmentData(
      Buffer.from("%PDF-1.4").toString("base64"),
    );
    expect(bytes.toString("utf8")).toBe("%PDF-1.4");
  });

  it("decodes base64url (MCP clients often use - and _)", () => {
    const raw = Buffer.from([0xfb, 0xff, 0xbf]);
    const bytes = decodeUploadedAttachmentData(raw.toString("base64url"));
    expect(Buffer.from(bytes)).toEqual(raw);
  });

  it("strips a data: URL prefix before decoding", () => {
    const payload = Buffer.from("%PDF-1.4 hello").toString("base64");
    const bytes = decodeUploadedAttachmentData(
      `data:application/pdf;base64,${payload}`,
    );
    expect(bytes.toString("utf8")).toBe("%PDF-1.4 hello");
  });

  it("rejects empty input", () => {
    expect(() => decodeUploadedAttachmentData("")).toThrow(/empty/i);
  });

  it("rejects punctuation-only placeholders that decode to zero bytes", () => {
    expect(() => decodeUploadedAttachmentData("...")).toThrow(/empty/i);
    expect(() => decodeUploadedAttachmentData("====")).toThrow(/empty/i);
  });

  it("rejects a data: URL with no payload", () => {
    expect(() =>
      decodeUploadedAttachmentData("data:application/pdf;base64,"),
    ).toThrow(/empty/i);
  });
});

describe("storedContentToBuffer", () => {
  it("returns null for missing content", () => {
    expect(storedContentToBuffer(null)).toBeNull();
    expect(storedContentToBuffer(undefined)).toBeNull();
  });

  it("returns null for an empty Buffer so callers fetch from IMAP instead of sending a 0-byte file", () => {
    expect(storedContentToBuffer(Buffer.alloc(0))).toBeNull();
    expect(storedContentToBuffer(new Uint8Array(0))).toBeNull();
  });

  it("returns a Buffer for non-empty stored bytes", () => {
    const fromBuf = storedContentToBuffer(Buffer.from("%PDF"));
    expect(Buffer.from(fromBuf!).toString("utf8")).toBe("%PDF");

    const fromArr = storedContentToBuffer(Uint8Array.from([1, 2, 3]));
    expect(Buffer.from(fromArr!).equals(Buffer.from([1, 2, 3]))).toBe(true);
  });
});
