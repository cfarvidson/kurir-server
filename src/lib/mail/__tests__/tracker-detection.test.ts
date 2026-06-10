// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  isLikelyTracker,
  isInvisiblePixel,
  isKnownTrackerUrl,
} from "../tracker-detection";

/** Build an <img> with the given attributes for detection tests. */
function img(attrs: Record<string, string>): HTMLImageElement {
  const el = document.createElement("img");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

describe("isKnownTrackerUrl", () => {
  it("matches a dedicated tracker host", () => {
    expect(isKnownTrackerUrl("https://emltrk.com/abc123")).toBe(true);
  });

  it("matches a subdomain of a listed host", () => {
    expect(isKnownTrackerUrl("https://x.emltrk.com/abc")).toBe(true);
  });

  it("does not match a non-dot-boundary suffix lookalike", () => {
    // List has list-manage.com; this must NOT match.
    expect(isKnownTrackerUrl("https://evil-list-manage.com/track/open")).toBe(
      false,
    );
  });

  it("honors path patterns: tracking path is a tracker", () => {
    expect(
      isKnownTrackerUrl("https://abc.list-manage.com/track/open.php?u=1"),
    ).toBe(true);
  });

  it("honors path patterns: non-tracking path on the same host is not", () => {
    expect(
      isKnownTrackerUrl("https://abc.list-manage.com/images/logo.png"),
    ).toBe(false);
  });

  it("returns false for unlisted ordinary CDN hosts", () => {
    expect(isKnownTrackerUrl("https://cdn.example.com/hero.png")).toBe(false);
  });

  it("does not throw and returns false on malformed input", () => {
    expect(isKnownTrackerUrl("not a url")).toBe(false);
    expect(isKnownTrackerUrl("")).toBe(false);
    expect(isKnownTrackerUrl("cid:abc@def")).toBe(false);
  });
});

describe("isInvisiblePixel", () => {
  it("flags a 1x1 image by attributes", () => {
    expect(isInvisiblePixel(img({ width: "1", height: "1" })).hit).toBe(true);
  });

  it("flags a width=0 image", () => {
    const v = isInvisiblePixel(img({ width: "0" }));
    expect(v.hit).toBe(true);
    expect(v.reason).toBe("pixel");
  });

  it("flags tiny CSS dimensions", () => {
    expect(isInvisiblePixel(img({ style: "width:0;height:0" })).hit).toBe(true);
  });

  it("flags display:none", () => {
    const v = isInvisiblePixel(img({ style: "display:none" }));
    expect(v.hit).toBe(true);
    expect(v.reason).toBe("hidden");
  });

  it("flags visibility:hidden", () => {
    expect(isInvisiblePixel(img({ style: "visibility:hidden" })).hit).toBe(
      true,
    );
  });

  it("flags opacity:0", () => {
    expect(isInvisiblePixel(img({ style: "opacity:0" })).hit).toBe(true);
  });

  it("does not flag a normal content image", () => {
    expect(
      isInvisiblePixel(img({ width: "600", height: "400" })).hit,
    ).toBe(false);
  });

  it("ignores percentage and auto dimensions", () => {
    expect(isInvisiblePixel(img({ width: "100%" })).hit).toBe(false);
    expect(isInvisiblePixel(img({ style: "width:auto" })).hit).toBe(false);
  });
});

describe("isLikelyTracker", () => {
  it("flags a known-domain tracker (reason=domain)", () => {
    const v = isLikelyTracker(
      img({ width: "20", height: "20" }),
      "https://emltrk.com/abc",
    );
    expect(v.tracker).toBe(true);
    expect(v.reason).toBe("domain");
  });

  it("flags a tiny pixel before consulting the domain list (reason=pixel)", () => {
    const v = isLikelyTracker(
      img({ width: "1", height: "1" }),
      "https://cdn.example.com/p.gif",
    );
    expect(v.tracker).toBe(true);
    expect(v.reason).toBe("pixel");
  });

  it("does not flag a legitimate content image from an unlisted host", () => {
    const v = isLikelyTracker(
      img({ width: "600", height: "400" }),
      "https://cdn.example.com/hero.png",
    );
    expect(v.tracker).toBe(false);
    expect(v.reason).toBeUndefined();
  });

  it("never mutates the element it inspects", () => {
    const el = img({ width: "1", height: "1", src: "https://emltrk.com/a" });
    const before = el.outerHTML;
    isLikelyTracker(el, "https://emltrk.com/a");
    expect(el.outerHTML).toBe(before);
  });
});
