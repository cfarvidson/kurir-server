import { db } from "@/lib/db";
import { splitPlainTextQuotes } from "@/lib/mail/quote-utils";
import { isKnownTrackerUrl } from "@/lib/mail/tracker-detection";

// Keep the chrome/asset/recurring rules in sync with kurir-ios PersonLinks.swift.

export type PersonLink = {
  id: string;
  url: string;
  title: string;
  messageId: string;
  receivedAt: Date;
};

const HREF_RE =
  /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const BARE_URL_RE = /https?:\/\/[^\s<>"'\)\]]+/gi;
const QUOTE_CUT_RE =
  /<blockquote\b|class=["'][^"']*\b(gmail_quote|moz-cite-prefix|yahoo_quoted|protonmail_quote)\b/i;

/** A path that shows up in this many of the scanned mails is footer chrome. */
export const RECURRING_LINK_THRESHOLD = 3;

const ASSET_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "ajax.googleapis.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
  "maxcdn.bootstrapcdn.com",
  "use.typekit.net",
  "use.fontawesome.com",
  "kit.fontawesome.com",
];

const ASSET_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".mjs",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".map",
  ".ico",
]);

const CHROME_TITLES = new Set([
  "login",
  "log in",
  "sign in",
  "sign up",
  "register",
  "docs",
  "documentation",
  "blog",
  "integrations",
  "public api",
  "api",
  "trust center",
  "privacy",
  "privacy policy",
  "terms",
  "terms of service",
  "help",
  "support",
  "contact",
  "about",
  "home",
  "website",
  "follow us",
  "view in browser",
  "preferences",
  "cookie policy",
  "legal",
  "security",
  "pricing",
  "careers",
  "twitter",
  "facebook",
  "linkedin",
  "instagram",
  "youtube",
  "x",
]);

const CHROME_PATHS = new Set([
  "",
  "/",
  "/login",
  "/signin",
  "/sign-in",
  "/log-in",
  "/signup",
  "/sign-up",
  "/register",
  "/docs",
  "/documentation",
  "/blog",
  "/privacy",
  "/privacy-policy",
  "/terms",
  "/terms-of-service",
  "/about",
  "/about-us",
  "/help",
  "/support",
  "/contact",
  "/contact-us",
  "/integrations",
  "/pricing",
  "/careers",
  "/legal",
  "/cookies",
  "/cookie-policy",
  "/security",
  "/trust",
  "/trust-center",
  "/status",
  "/faq",
  "/news",
  "/download",
  "/public-api",
  "/api",
]);

const CHROME_SEGMENTS = new Set([
  "login",
  "signin",
  "sign-in",
  "log-in",
  "signup",
  "sign-up",
  "register",
  "docs",
  "documentation",
  "blog",
  "privacy",
  "privacy-policy",
  "terms",
  "terms-of-service",
  "cookie-policy",
  "trust-center",
  "unsubscribe",
  "integrations",
  "public-api",
]);

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "twclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "vero_id",
  "wickedid",
]);

export function visibleHtml(html: string): string {
  const match = QUOTE_CUT_RE.exec(html);
  if (!match || match.index === 0) return html;
  const visible = html.slice(0, match.index);
  const text = visible.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim();
  return text.length === 0 ? html : visible;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function displayUrl(url: URL): string {
  let text = url.toString();
  if (text.endsWith("/")) text = text.slice(0, -1);
  const scheme = text.indexOf("://");
  return scheme >= 0 ? text.slice(scheme + 3) : text;
}

function hostIs(hostname: string, listed: string): boolean {
  const host = hostname.toLowerCase();
  return host === listed || host.endsWith(`.${listed}`);
}

function normalizedPath(url: URL): string {
  let path = url.pathname || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

function lastSegment(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

function extensionOf(path: string): string {
  const base = lastSegment(path);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

function normalizedTitle(title: string | null | undefined): string {
  return (title ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  return key.startsWith("utm_") || TRACKING_PARAMS.has(key);
}

function queryWithoutTracking(url: URL): string {
  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (isTrackingParam(key)) params.delete(key);
  }
  const kept = params.toString();
  return kept ? `?${kept}` : "";
}

export function pathKey(url: URL): string {
  return url.hostname.toLowerCase() + normalizedPath(url);
}

function isAssetHost(hostname: string): boolean {
  return ASSET_HOSTS.some((listed) => hostIs(hostname, listed));
}

function isChromeLink(url: URL, title: string | null): boolean {
  const path = normalizedPath(url).toLowerCase();
  if (CHROME_PATHS.has(path)) return true;
  if (CHROME_SEGMENTS.has(lastSegment(path))) return true;
  if (ASSET_EXTENSIONS.has(extensionOf(path))) return true;
  if (isAssetHost(url.hostname)) return true;
  const label = normalizedTitle(title);
  if (label && CHROME_TITLES.has(label)) return true;
  return false;
}

export function dedupKey(url: URL): string {
  return pathKey(url) + queryWithoutTracking(url);
}

export function accept(
  raw: string,
  title: string | null,
): { url: string; title: string; key: string } | null {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(":", "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") return null;
  if (!url.hostname) return null;
  if (isKnownTrackerUrl(trimmed)) return null;
  const combined = `${title ?? ""} ${url.pathname} ${url.hostname}`.toLowerCase();
  if (combined.includes("unsubscribe")) return null;
  if (isChromeLink(url, title)) return null;
  const key = dedupKey(url);
  const label =
    title && title.length > 0 && !title.startsWith("http")
      ? title
      : displayUrl(url);
  return { url: url.toString(), title: label, key };
}

export function extractLinks(
  html: string | null | undefined,
  text: string | null | undefined,
): { url: string; title: string; key: string }[] {
  const visibleHTML = html ? visibleHtml(html) : null;
  const visibleText = text ? splitPlainTextQuotes(text).body : null;
  const found: { url: string; title: string; key: string }[] = [];
  const seen = new Set<string>();

  if (visibleHTML) {
    HREF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HREF_RE.exec(visibleHTML))) {
      const accepted = accept(
        decodeEntities(match[1]),
        stripTags(match[2]),
      );
      if (accepted && !seen.has(accepted.key)) {
        seen.add(accepted.key);
        found.push(accepted);
      }
    }
  }

  const bareSources = [
    visibleHTML ? stripTags(visibleHTML) : null,
    visibleText,
  ].filter((s): s is string => Boolean(s));
  for (const source of bareSources) {
    BARE_URL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BARE_URL_RE.exec(source))) {
      let raw = match[0];
      while (/[.,;:!?]$/.test(raw)) raw = raw.slice(0, -1);
      const accepted = accept(raw, null);
      if (accepted && !seen.has(accepted.key)) {
        seen.add(accepted.key);
        found.push(accepted);
      }
    }
  }
  return found;
}

export async function loadPersonLinks(
  userId: string,
  email: string,
): Promise<PersonLink[]> {
  const lowered = email.toLowerCase();
  const messages = await db.message.findMany({
    where: {
      userId,
      isDraft: false,
      isDeleted: false,
      OR: [{ fromAddress: lowered }, { toAddresses: { has: lowered } }],
    },
    select: {
      id: true,
      textBody: true,
      receivedAt: true,
    },
    orderBy: { receivedAt: "desc" },
    take: 40,
  });
  type Hit = {
    path: string;
    extracted: { url: string; title: string; key: string };
    messageId: string;
    receivedAt: Date;
  };
  const hits: Hit[] = [];
  const pathCounts = new Map<string, number>();

  for (const message of messages) {
    if (!message.textBody) continue;
    const seenPaths = new Set<string>();
    for (const extracted of extractLinks(null, message.textBody)) {
      let path: string;
      try {
        path = pathKey(new URL(extracted.url));
      } catch {
        continue;
      }
      hits.push({
        path,
        extracted,
        messageId: message.id,
        receivedAt: message.receivedAt,
      });
      if (!seenPaths.has(path)) {
        seenPaths.add(path);
        pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
      }
    }
  }

  const byKey = new Map<string, PersonLink>();
  const order: string[] = [];
  for (const hit of hits) {
    if ((pathCounts.get(hit.path) ?? 0) >= RECURRING_LINK_THRESHOLD) continue;
    if (byKey.has(hit.extracted.key)) continue;
    order.push(hit.extracted.key);
    byKey.set(hit.extracted.key, {
      id: hit.extracted.key,
      url: hit.extracted.url,
      title: hit.extracted.title,
      messageId: hit.messageId,
      receivedAt: hit.receivedAt,
    });
  }
  return order.map((key) => byKey.get(key)!);
}

export function linkMatches(link: PersonLink, query: string): boolean {
  const needle = query.trim();
  if (!needle) return false;
  const lower = needle.toLowerCase();
  return (
    link.title.toLowerCase().includes(lower) ||
    link.url.toLowerCase().includes(lower)
  );
}
