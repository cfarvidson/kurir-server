import DOMPurify from "dompurify";
import {
  ATTRIBUTION_START_WORDS,
  ATTRIBUTION_VERBS,
  MOBILE_APP_LINE,
  SENT_FROM,
  SIGNATURE_DELIMITER,
  isForwardHeader,
} from "@/lib/mail/quote-utils";
import { isLikelyTracker } from "./tracker-detection";

export interface CidAttachment {
  id: string;
  contentId: string | null;
}

export interface SanitizeOptions {
  /**
   * When true, the trailing quoted / signature part is cut from the output
   * (see `findQuoteBoundary`). `quoteCollapsible` in the result says whether
   * there was anything to cut, regardless of this flag.
   */
  collapseQuotes?: boolean;
  /** Message attachments for CID→URL rewriting */
  attachments?: CidAttachment[];
  /**
   * When true, remote http(s) images are NOT requested: their `src` is moved
   * to a `data-blocked-src` attribute and removed, so tracking pixels never
   * fire. CID and internal attachment images are unaffected. Defaults to
   * false (remote images are proxied as before).
   */
  blockRemoteImages?: boolean;
  /**
   * When true (and `blockRemoteImages` is false), remote images are loaded
   * (proxied) EXCEPT those detected as trackers — known tracker domains and
   * invisible spy pixels — which are stripped to `data-blocked-src` exactly
   * like the full block. This is the "load images, block trackers" middle
   * ground. Ignored when `blockRemoteImages` is true. Defaults to false.
   */
  blockTrackers?: boolean;
}

export interface SanitizeResult {
  /** Sanitized HTML safe for shadow-DOM injection. */
  html: string;
  /**
   * Number of remote http(s) images whose `src` was stripped because
   * `blockRemoteImages` was enabled. Zero when blocking is off.
   */
  blockedRemoteImages: number;
  /**
   * Number of remote images stripped specifically because they were detected
   * as trackers in `blockTrackers` mode. Zero in the other modes.
   */
  blockedTrackers: number;
  /** True when the body has a quoted / signature tail that can be collapsed. */
  quoteCollapsible: boolean;
}

/** Build the proxied URL used to load a remote image through our own server. */
export function proxiedImageUrl(remoteUrl: string): string {
  return `/api/proxy/image?url=${encodeURIComponent(remoteUrl)}`;
}

/**
 * Safe structural tags allowed in email HTML.
 * Excludes script, style, iframe, object, embed, form, input, link, meta, etc.
 */
const ALLOWED_TAGS = [
  "div",
  "span",
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "sub",
  "sup",
  "a",
  "img",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "caption",
  "colgroup",
  "col",
  "blockquote",
  "pre",
  "code",
  "figure",
  "figcaption",
  "address",
  "cite",
  "abbr",
  "time",
  "dl",
  "dt",
  "dd",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "nav",
  // <style> blocks removed: CSS url() can bypass image proxy for tracking.
  // Allow <center> for legacy email layouts
  "center",
];

/**
 * Safe attributes allowed on elements.
 * Inline style is included so email formatting is preserved.
 * on* event handlers are NOT listed and therefore stripped.
 */
const ALLOWED_ATTR = [
  // Universal
  "id",
  "class",
  "style",
  "dir",
  "lang",
  "title",
  "aria-label",
  "aria-hidden",
  "aria-describedby",
  "role",
  // Links
  "href",
  "target",
  "rel",
  "name",
  // Images
  "src",
  "alt",
  "width",
  "height",
  "loading",
  // Tables
  "colspan",
  "rowspan",
  "align",
  "valign",
  "border",
  "cellpadding",
  "cellspacing",
  // Data attributes (used by some email clients for quote markers)
  "data-*",
];

/**
 * Sanitize an email HTML body for safe rendering in a sandboxed iframe.
 *
 * - Uses an explicit ALLOWED_TAGS allowlist — anything not listed is stripped.
 * - Removes all event handler attributes (on*).
 * - Preserves safe inline styles and structural HTML.
 * - Forces target="_blank" + rel="noopener noreferrer" on all links.
 * - Allows only http/https/cid image sources (strips data: URIs and others).
 * - Optionally strips quoted-text elements (blockquote, .gmail_quote, etc.).
 *
 * Must only be called in a browser environment (DOMPurify requires a DOM).
 *
 * Returns the sanitized string only. Use {@link sanitizeEmailHtmlWithMeta}
 * when the caller needs the blocked-tracker count.
 */
export function sanitizeEmailHtml(
  html: string,
  options: SanitizeOptions = {},
): string {
  return sanitizeEmailHtmlWithMeta(html, options).html;
}

/**
 * Like {@link sanitizeEmailHtml} but also reports how many remote images were
 * blocked (only meaningful when `options.blockRemoteImages` is true).
 */
export function sanitizeEmailHtmlWithMeta(
  html: string,
  options: SanitizeOptions = {},
): SanitizeResult {
  if (typeof window === "undefined") {
    // Server-side: return empty string — the iframe renders client-side only.
    return {
      html: "",
      blockedRemoteImages: 0,
      blockedTrackers: 0,
      quoteCollapsible: false,
    };
  }

  const purify = DOMPurify(window);

  const clean = purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Allow data-* attributes (some email clients use them for quote markers).
    ALLOW_DATA_ATTR: true,
    // Do not allow unknown protocols in href/src.
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });

  // Parse the clean HTML into a DOM for post-processing.
  const parser = new DOMParser();
  const doc = parser.parseFromString(clean, "text/html");

  // 1. Enforce target="_blank" + rel="noopener noreferrer" on all links.
  doc.querySelectorAll("a").forEach((a) => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });

  // 2. Build CID→attachment URL map for inline image rewriting.
  const cidMap = new Map<string, string>();
  if (options.attachments) {
    for (const att of options.attachments) {
      if (att.contentId) {
        // CID can appear with or without angle brackets
        const cid = att.contentId.replace(/^<|>$/g, "");
        cidMap.set(cid.toLowerCase(), `/api/attachments/${att.id}`);
      }
    }
  }

  // 3. Filter dangerous img src, rewrite CID to attachment URLs, proxy or block
  //    external images. Tracker detection runs here, BEFORE step 4 strips inline
  //    style url()s, so `display:none` / `width:0` pixels are still detectable.
  let blockedRemoteImages = 0;
  let blockedTrackers = 0;
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    if (src.startsWith("/api/attachments/")) {
      // Internal attachment URLs — allow as-is (used by sent messages)
    } else if (src && !/^(https?:|cid:)/i.test(src)) {
      img.removeAttribute("src");
    } else if (/^cid:/i.test(src)) {
      const cid = src.replace(/^cid:/i, "").toLowerCase();
      const attachmentUrl = cidMap.get(cid);
      if (attachmentUrl) {
        img.setAttribute("src", attachmentUrl);
      } else {
        img.removeAttribute("src");
      }
    } else if (/^https?:/i.test(src)) {
      if (options.blockRemoteImages) {
        // Do not request the remote resource — stash the original URL so the
        // user can opt in to loading it later, then strip the live src.
        img.setAttribute("data-blocked-src", src);
        img.removeAttribute("src");
        blockedRemoteImages += 1;
      } else if (options.blockTrackers && isLikelyTracker(img, src).tracker) {
        // Load images mode, but this one is a known tracker / spy pixel —
        // strip it the same way (no request fires) and count it separately.
        img.setAttribute("data-blocked-src", src);
        img.removeAttribute("src");
        blockedTrackers += 1;
      } else {
        img.setAttribute("src", proxiedImageUrl(src));
      }
    }
  });

  // 4. Strip CSS resource loads from inline styles (tracking pixels / SSRF).
  //    Comments are removed first so `url/**/(...)` cannot hide a fetch.
  doc.querySelectorAll("[style]").forEach((el) => {
    const style = el.getAttribute("style") ?? "";
    const cleaned = stripCssResourceLoads(style);
    if (cleaned !== style) {
      if (cleaned.trim()) {
        el.setAttribute("style", cleaned);
      } else {
        el.removeAttribute("style");
      }
    }
  });

  // 5. Optionally collapse the quoted / signature tail.
  const boundary = findQuoteBoundary(doc);
  if (boundary && options.collapseQuotes) truncateFrom(boundary, doc.body);

  return {
    html: doc.body.innerHTML,
    blockedRemoteImages,
    blockedTrackers,
    quoteCollapsible: boundary !== null,
  };
}

/** Exported for tests. Removes CSS comments, then drops url()/image-set(). */
export function stripCssResourceLoads(style: string): string {
  const withoutComments = style.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutFunctions = withoutComments
    .replace(/url\s*\([^)]*\)/gi, "none")
    .replace(/image-set\s*\([^)]*\)/gi, "none")
    .replace(/image\s*\([^)]*\)/gi, "none");
  // Hex-escaped `url(` (e.g. \75\72\6c(...)) — drop the whole declaration
  // rather than trying to decode CSS escapes.
  return withoutFunctions
    .split(";")
    .map((decl) => decl.trim())
    .filter((decl) => decl && !/\\[0-9a-f]{1,6}/i.test(decl))
    .join("; ");
}

// ---------------------------------------------------------------------------
// Quote / signature boundary
//
// Mirrored by the iOS client in `QuoteDetection.swift`; keep the two in step.
// Only strong signals count: explicit wrapper classes/ids that mail clients
// emit, the Outlook desktop reply header, a trailing blockquote, the "-- "
// signature separator and "Sent from my iPhone"-style closers.
// ---------------------------------------------------------------------------

/** Wrappers that contain the whole quoted thread or the signature. */
const QUOTE_WRAPPER_SELECTOR = [
  ".gmail_quote",
  ".moz-cite-prefix",
  ".yahoo_quoted",
  ".protonmail_quote",
  "#divRplyFwdMsg",
  "#appendonsend",
  ".gmail_signature",
  ".moz-signature",
  "#Signature",
  "#ms-outlook-mobile-signature",
].join(", ");

const HTML_ATTRIBUTION = new RegExp(
  `^(${ATTRIBUTION_START_WORDS})\\s[\\s\\S]*\\b(${ATTRIBUTION_VERBS})\\b[^:]*:$`,
  "i",
);

/** Tags whose start ends a run of inline text when walking back. */
const BLOCK_TAGS = new Set([
  "DIV",
  "P",
  "TABLE",
  "TBODY",
  "TR",
  "TD",
  "TH",
  "UL",
  "OL",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "SECTION",
  "ARTICLE",
  "HEADER",
  "FOOTER",
  "PRE",
  "CENTER",
  "BLOCKQUOTE",
  "HR",
]);

/** Whitespace (incl. non-breaking) collapsed to single spaces, trimmed. */
function normalizeText(text: string): string {
  return text.replace(/[\s\u00a0]+/g, " ").trim();
}

/** Element text with entities decoded and whitespace collapsed. */
function elementText(el: Node): string {
  return normalizeText(el.textContent ?? "");
}

/** Non-blank lines of an element, `<br>` as the line break. */
function elementLines(el: Element): string[] {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return (clone.textContent ?? "")
    .split("\n")
    .map(normalizeText)
    .filter((l) => l !== "");
}

/** True when no visible text follows `el` in document order. */
function isTrailing(el: Element, body: HTMLElement): boolean {
  let node: Node | null = el;
  while (node && node !== body) {
    for (let sib = node.nextSibling; sib; sib = sib.nextSibling) {
      if (sib.nodeType === 8 /* COMMENT_NODE */) continue;
      if (elementText(sib) !== "") return false;
    }
    node = node.parentNode;
  }
  return true;
}

/** A one-line "Sent from my iPhone" / "Get Outlook for iOS" element. */
function isSentFromLine(el: Element): boolean {
  const lines = elementLines(el);
  return (
    lines.length === 1 &&
    (SENT_FROM.test(lines[0]) || MOBILE_APP_LINE.test(lines[0]))
  );
}

/** Outlook desktop: `<div style="border-top:…"><p><b>From:</b> … <br><b>Sent:</b> …`. */
function isOutlookHeader(el: Element): boolean {
  if (!/border-top/i.test(el.getAttribute("style") ?? "")) return false;
  const lines = elementLines(el);
  return lines.length > 0 && isForwardHeader(lines, 0);
}

function isMarker(el: Element, body: HTMLElement): boolean {
  if (el.matches(QUOTE_WRAPPER_SELECTOR)) return true;
  const tag = el.tagName;
  if (tag === "BLOCKQUOTE") return isTrailing(el, body);
  if (tag !== "DIV" && tag !== "P") return false;
  if (isOutlookHeader(el)) return true;
  const text = elementText(el);
  if (text.length > 200) return false;
  if (SIGNATURE_DELIMITER.test(text)) return true;
  if (isSentFromLine(el)) return isTrailing(el, body);
  return false;
}

/**
 * One step of pulling the boundary backwards: an attribution or "Sent from"
 * element, a trailing blockquote (a signature below the quote), or an
 * `<hr>` right before it. Inline elements and `<br>`s are read as text;
 * blank elements without images are skipped. Returns null when the
 * boundary stays.
 */
function extendBoundaryOnce(
  boundary: Element,
  body: HTMLElement,
): Element | null {
  let before = "";
  let prevEl: Element | null = null;
  for (let n = boundary.previousSibling; n; n = n.previousSibling) {
    if (n.nodeType === 1) {
      const el = n as Element;
      if (BLOCK_TAGS.has(el.tagName)) {
        // Spacer paragraphs (Outlook's `<p><o:p>&nbsp;</o:p></p>`) carry
        // nothing visible; look past them.
        if (
          before === "" &&
          elementText(el) === "" &&
          !el.querySelector("img")
        ) {
          continue;
        }
        prevEl = el;
        break;
      }
      if (el.tagName === "BR") continue;
    }
    before = (n.textContent ?? "") + before;
  }
  before = normalizeText(before);
  const parent = boundary.parentElement;
  if (before === "" && prevEl) {
    if (
      prevEl.tagName === "HR" ||
      prevEl.tagName === "BLOCKQUOTE" ||
      HTML_ATTRIBUTION.test(elementText(prevEl)) ||
      isSentFromLine(prevEl)
    ) {
      return prevEl;
    }
    return null;
  }
  if (before !== "" && !prevEl && parent && parent !== body) {
    // Bare text before the marker inside a shared parent (Apple Mail puts
    // "Den … skrev X:<br>" and the blockquote in one div).
    if (HTML_ATTRIBUTION.test(before)) return parent;
  }
  return null;
}

/**
 * The element where the quoted / signature tail begins, or null. The first
 * marker in document order wins, then the boundary is pulled back over what
 * belongs to the tail (see `extendBoundaryOnce`). Null when nothing visible
 * would remain above the boundary.
 */
export function findQuoteBoundary(doc: Document): Element | null {
  const body = doc.body;
  let boundary: Element | null = null;
  for (const el of Array.from(body.querySelectorAll("*"))) {
    if (isMarker(el, body)) {
      boundary = el;
      break;
    }
  }
  if (!boundary) return null;

  // Pull the boundary back over attribution lines, "Sent from" lines, a
  // quote that a signature marker sits below, and Outlook web's <hr>.
  for (let i = 0; i < 8; i++) {
    const earlier = extendBoundaryOnce(boundary, body);
    if (!earlier) break;
    boundary = earlier;
  }

  // Whole body quoted: collapsing would leave nothing visible.
  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */);
  let visible = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (
      boundary.contains(n) ||
      boundary.compareDocumentPosition(n) & 4 /* DOCUMENT_POSITION_FOLLOWING */
    ) {
      break;
    }
    if (elementText(n) !== "") {
      visible = true;
      break;
    }
  }
  return visible ? boundary : null;
}

/** Remove `el` and everything after it in document order, up to `body`. */
function truncateFrom(el: Element, body: HTMLElement): void {
  let node: Node | null = el;
  while (node && node !== body) {
    while (node.nextSibling) node.nextSibling.remove();
    node = node.parentNode;
  }
  el.remove();
}
