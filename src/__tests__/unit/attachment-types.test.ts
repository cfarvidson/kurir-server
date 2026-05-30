import { describe, it, expect } from "vitest";
import {
  normalizeContentType,
  isImageType,
  isSvg,
  isSafeInlineImage,
  isPdf,
  isViewableText,
  isInlineViewable,
  canPreview,
} from "@/lib/mail/attachment-types";

/**
 * Tests for the attachment MIME classification policy — the single source of
 * truth shared by the attachment GET route and the in-app AttachmentViewer.
 *
 * The security-critical invariant: types that can execute script in our origin
 * (SVG, HTML) must never be treated as inline-viewable or previewable, in any
 * casing or with any MIME parameters.
 */

describe("normalizeContentType", () => {
  it("strips parameters, trims, and lowercases", () => {
    expect(normalizeContentType("text/HTML; charset=utf-8")).toBe("text/html");
    expect(normalizeContentType("  Application/PDF ")).toBe("application/pdf");
    expect(normalizeContentType("IMAGE/SVG+XML")).toBe("image/svg+xml");
  });

  it("handles null/undefined/empty", () => {
    expect(normalizeContentType(null)).toBe("");
    expect(normalizeContentType(undefined)).toBe("");
    expect(normalizeContentType("")).toBe("");
  });
});

describe("isSafeInlineImage", () => {
  it("accepts raster images", () => {
    expect(isSafeInlineImage("image/png")).toBe(true);
    expect(isSafeInlineImage("image/jpeg")).toBe(true);
    expect(isSafeInlineImage("IMAGE/PNG")).toBe(true);
    expect(isSafeInlineImage("image/webp")).toBe(true);
  });

  it("rejects SVG in every form (can carry script)", () => {
    expect(isSafeInlineImage("image/svg+xml")).toBe(false);
    expect(isSafeInlineImage("IMAGE/SVG+XML")).toBe(false);
    expect(isSafeInlineImage("image/svg+xml; charset=utf-8")).toBe(false);
  });

  it("isImageType still reports SVG as an image (it just isn't *safe*)", () => {
    expect(isImageType("image/svg+xml")).toBe(true);
    expect(isSvg("image/svg+xml")).toBe(true);
  });
});

describe("isViewableText", () => {
  it("accepts plain text variants", () => {
    expect(isViewableText("text/plain")).toBe(true);
    expect(isViewableText("text/csv")).toBe(true);
    expect(isViewableText("text/markdown")).toBe(true);
    expect(isViewableText("text/plain; charset=utf-8")).toBe(true);
  });

  it("rejects HTML in every form (can run script)", () => {
    expect(isViewableText("text/html")).toBe(false);
    expect(isViewableText("TEXT/HTML")).toBe(false);
    expect(isViewableText("text/html; charset=utf-8")).toBe(false);
  });
});

describe("isInlineViewable (route ?inline=1 gate)", () => {
  it("allows PDF and plain text", () => {
    expect(isInlineViewable("application/pdf")).toBe(true);
    expect(isInlineViewable("application/pdf; name=x.pdf")).toBe(true);
    expect(isInlineViewable("text/plain")).toBe(true);
  });

  it("blocks the XSS-capable types regardless of casing/params", () => {
    expect(isInlineViewable("image/svg+xml")).toBe(false);
    expect(isInlineViewable("image/svg+xml; charset=utf-8")).toBe(false);
    expect(isInlineViewable("text/html")).toBe(false);
    expect(isInlineViewable("text/html; charset=utf-8")).toBe(false);
    expect(isInlineViewable("TEXT/HTML")).toBe(false);
  });

  it("does not treat raster images as inline-viewable (they go via <img>)", () => {
    expect(isInlineViewable("image/png")).toBe(false);
  });
});

describe("canPreview (viewer)", () => {
  it("previews safe images, PDFs, and plain text", () => {
    expect(canPreview("image/png")).toBe(true);
    expect(canPreview("application/pdf")).toBe(true);
    expect(canPreview("text/plain")).toBe(true);
  });

  it("never previews SVG or HTML", () => {
    expect(canPreview("image/svg+xml")).toBe(false);
    expect(canPreview("image/svg+xml; charset=utf-8")).toBe(false);
    expect(canPreview("text/html")).toBe(false);
    expect(canPreview("text/html; charset=utf-8")).toBe(false);
  });

  it("does not preview arbitrary binary types", () => {
    expect(canPreview("application/zip")).toBe(false);
    expect(canPreview("application/octet-stream")).toBe(false);
    expect(canPreview("")).toBe(false);
  });
});

describe("inline-safety invariant (the headline guarantee)", () => {
  // Mirrors how the route decides Content-Disposition: inline.
  const servedInline = (ct: string) =>
    isSafeInlineImage(ct) || isInlineViewable(ct);

  const dangerous = [
    "image/svg+xml",
    "IMAGE/SVG+XML",
    "image/svg+xml; charset=utf-8",
    "text/html",
    "TEXT/HTML",
    "text/html; charset=utf-8",
  ];

  it.each(dangerous)("never serves %s with an inline disposition", (ct) => {
    expect(servedInline(ct)).toBe(false);
  });

  it.each(dangerous)("never offers %s for in-app preview", (ct) => {
    expect(canPreview(ct)).toBe(false);
  });
});
