/**
 * Root-relative URLs the browser requests itself. Next prefixes Link and
 * next/image when basePath is set. fetch, EventSource, and raw img/src do not.
 *
 * NEXT_PUBLIC_BASE_PATH is inlined at build time. Leave it empty to serve
 * the app at the host root, which is the default.
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");

export function apiPath(path: string): string {
  if (!basePath || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === basePath || path.startsWith(`${basePath}/`)) return path;
  return `${basePath}${path}`;
}

/** Prefix root-relative src and href values inside HTML the browser will load. */
export function prefixAppUrls(html: string): string {
  if (!basePath) return html;
  return html.replace(
    /(\s(?:src|href)=["'])\/(?!\/)/g,
    `$1${basePath}/`,
  );
}
