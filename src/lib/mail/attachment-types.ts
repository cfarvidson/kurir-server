/**
 * Single source of truth for how an attachment's MIME type is classified for
 * inline rendering. The attachment GET route (server) and the in-app
 * AttachmentViewer (client) both import from here so the security-sensitive
 * "what is safe to serve / render inline" policy can never drift between the
 * two.
 *
 * Every check normalises first (drops `; charset=...` parameters, trims,
 * lowercases) so values like `text/html; charset=utf-8` or `IMAGE/SVG+XML`
 * cannot slip past an exact-match guard.
 */

/** Strip parameters (e.g. `; charset=utf-8`), trim, and lowercase a Content-Type. */
export function normalizeContentType(
  contentType: string | null | undefined,
): string {
  return (contentType || "").split(";")[0].trim().toLowerCase();
}

export function isImageType(contentType: string): boolean {
  return normalizeContentType(contentType).startsWith("image/");
}

/** SVG can carry inline `<script>`; it must never be treated as a safe image. */
export function isSvg(contentType: string): boolean {
  return normalizeContentType(contentType) === "image/svg+xml";
}

/** Raster/vector images we can render via `<img>` without script execution (SVG excluded). */
export function isSafeInlineImage(contentType: string): boolean {
  return isImageType(contentType) && !isSvg(contentType);
}

export function isPdf(contentType: string): boolean {
  return normalizeContentType(contentType) === "application/pdf";
}

/** Text we can render inline without script execution. HTML is excluded (can run script). */
export function isViewableText(contentType: string): boolean {
  const ct = normalizeContentType(contentType);
  return ct.startsWith("text/") && ct !== "text/html";
}

/**
 * Types we will serve with an inline `Content-Disposition` when the client
 * explicitly asks (`?inline=1`). Deliberately excludes `text/html` and
 * `image/svg+xml`, which could execute script in our origin (XSS) if rendered
 * inline. Images are handled separately (served via `<img>`, not this gate).
 */
export function isInlineViewable(contentType: string): boolean {
  return isPdf(contentType) || isViewableText(contentType);
}

/**
 * Whether the in-app viewer can preview this attachment. Safe images render via
 * `<img>`, PDFs and plain text render in an inline/sandboxed frame; everything
 * else (including SVG and HTML) is download/share only.
 */
export function canPreview(contentType: string): boolean {
  return (
    isSafeInlineImage(contentType) ||
    isPdf(contentType) ||
    isViewableText(contentType)
  );
}
