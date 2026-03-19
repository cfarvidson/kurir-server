import DOMPurify from "dompurify";

export interface SanitizeOptions {
  /** When true, strip blockquote / gmail_quote elements from the output. */
  collapseQuotes?: boolean;
}

/**
 * Safe structural tags allowed in email HTML.
 * Excludes script, style, iframe, object, embed, form, input, link, meta, etc.
 */
const ALLOWED_TAGS = [
  "div", "span", "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "em", "b", "i", "u", "s", "sub", "sup",
  "a", "img",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "caption", "colgroup", "col",
  "blockquote", "pre", "code",
  "figure", "figcaption",
  "address", "cite", "abbr", "time",
  "dl", "dt", "dd",
  "section", "article", "header", "footer", "main", "aside", "nav",
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
  "id", "class", "style", "dir", "lang", "title", "aria-label",
  "aria-hidden", "aria-describedby", "role",
  // Links
  "href", "target", "rel", "name",
  // Images
  "src", "alt", "width", "height", "loading",
  // Tables
  "colspan", "rowspan", "align", "valign", "border",
  "cellpadding", "cellspacing",
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
 */
export function sanitizeEmailHtml(
  html: string,
  options: SanitizeOptions = {}
): string {
  if (typeof window === "undefined") {
    // Server-side: return empty string — the iframe renders client-side only.
    return "";
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

  // 2. Filter dangerous img src and rewrite external images to proxy.
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    if (src && !/^(https?:|cid:)/i.test(src)) {
      img.removeAttribute("src");
    } else if (/^https?:/i.test(src)) {
      img.setAttribute(
        "src",
        `/api/proxy/image?url=${encodeURIComponent(src)}`,
      );
    }
  });

  // 4. Optionally collapse quotes.
  if (options.collapseQuotes) {
    // Standard blockquotes.
    doc.querySelectorAll("blockquote").forEach((el) => el.remove());
    // Gmail / Mozilla / Yahoo / Proton quote wrappers.
    doc
      .querySelectorAll(
        ".gmail_quote, .moz-cite-prefix, .yahoo_quoted, .protonmail_quote"
      )
      .forEach((el) => el.remove());
    // "On <date>, <name> wrote:" attribution paragraphs preceding quotes.
    doc.querySelectorAll("p, div").forEach((el) => {
      if (/^On .+wrote:\s*$/.test(el.textContent?.trim() ?? "")) {
        el.remove();
      }
    });
  }

  return doc.body.innerHTML;
}
