/**
 * Pure, dependency-light heuristics for deciding whether a remote `<img>` in an
 * email is a tracking pixel (a "spy pixel") rather than legitimate content.
 *
 * Two signals, both evaluated PRE-FETCH so a detected tracker never makes a
 * network request:
 *
 *  1. {@link isInvisiblePixel} — the generic catch-all: the image declares a
 *     tracking-sized or hidden footprint (1x1 / 0x0 via width/height attributes
 *     or inline CSS, `display:none`, `visibility:hidden`, `opacity:0`).
 *  2. {@link isKnownTrackerUrl} — the high-precision backbone: the URL matches a
 *     curated known-tracker domain/path list ({@link TRACKER_DOMAINS}).
 *
 * This module mutates nothing and touches no globals; it only reads attributes
 * off the `<img>` element it is handed. That keeps it trivially unit-testable
 * and safe to call from the sanitizer's existing DOM pass.
 */

import { TRACKER_DOMAINS } from "./tracker-domains";

export type TrackerReason = "domain" | "pixel" | "hidden";

export interface TrackerVerdict {
  tracker: boolean;
  reason?: TrackerReason;
}

/** A dimension value (attribute or CSS) that is present and ≤ 1px. */
function isTinyDimension(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const trimmed = raw.trim();
  if (trimmed === "") return false;
  // Percentages and `auto` are not a fixed tiny size — ignore them.
  if (trimmed.endsWith("%") || /auto/i.test(trimmed)) return false;
  // Pull the leading number (handles "0", "1", "0px", "1px", "0.5px").
  const match = trimmed.match(/^-?\d*\.?\d+/);
  if (!match) return false;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) && value <= 1;
}

/** Read a single CSS declaration value out of an inline `style` string. */
function readStyleProp(style: string, prop: string): string | null {
  // Match `prop: value` up to the next `;` or end of string.
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i");
  const m = style.match(re);
  return m ? m[1].trim() : null;
}

/**
 * True when the image is sized/styled to be invisible — the classic spy-pixel
 * shape — regardless of which domain it comes from. Reads declared dimensions
 * and inline style only (rendered/natural size is not available pre-fetch).
 */
export function isInvisiblePixel(img: Element): {
  hit: boolean;
  reason?: TrackerReason;
} {
  // 1. width/height ATTRIBUTES (e.g. <img width="1" height="1">, or "0").
  if (
    isTinyDimension(img.getAttribute("width")) ||
    isTinyDimension(img.getAttribute("height"))
  ) {
    return { hit: true, reason: "pixel" };
  }

  const style = img.getAttribute("style");
  if (style) {
    // 2. Hidden via CSS — display/visibility/opacity.
    const display = readStyleProp(style, "display");
    if (display && /^none$/i.test(display)) {
      return { hit: true, reason: "hidden" };
    }
    const visibility = readStyleProp(style, "visibility");
    if (visibility && /^(hidden|collapse)$/i.test(visibility)) {
      return { hit: true, reason: "hidden" };
    }
    const opacity = readStyleProp(style, "opacity");
    if (opacity && Number.parseFloat(opacity) === 0) {
      return { hit: true, reason: "hidden" };
    }

    // 3. Tiny via CSS dimensions.
    if (
      isTinyDimension(readStyleProp(style, "width")) ||
      isTinyDimension(readStyleProp(style, "height")) ||
      isTinyDimension(readStyleProp(style, "max-width")) ||
      isTinyDimension(readStyleProp(style, "max-height"))
    ) {
      return { hit: true, reason: "pixel" };
    }
  }

  return { hit: false };
}

/** Match a hostname against a tracker host on a dot boundary (no false suffixes). */
function hostMatches(hostname: string, trackerHost: string): boolean {
  const h = hostname.toLowerCase();
  const t = trackerHost.toLowerCase();
  return h === t || h.endsWith(`.${t}`);
}

/**
 * True when the URL points at a curated known tracker. Host-suffix match on a
 * dot boundary so `notatracker-example.com` never matches `example.com`. When
 * an entry carries `paths`, the pathname must also contain one of them.
 */
export function isKnownTrackerUrl(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (!/^https?:$/i.test(url.protocol)) return false;

  const pathname = url.pathname.toLowerCase();
  for (const entry of TRACKER_DOMAINS) {
    if (!hostMatches(url.hostname, entry.host)) continue;
    if (!entry.paths || entry.paths.length === 0) return true;
    if (entry.paths.some((p) => pathname.includes(p.toLowerCase()))) {
      return true;
    }
  }
  return false;
}

/**
 * Decide whether a remote image is a likely tracker. The cheap dimension check
 * runs before the list lookup. Pure: never mutates the element.
 */
export function isLikelyTracker(img: Element, src: string): TrackerVerdict {
  const pixel = isInvisiblePixel(img);
  if (pixel.hit) return { tracker: true, reason: pixel.reason };
  if (isKnownTrackerUrl(src)) return { tracker: true, reason: "domain" };
  return { tracker: false };
}
