import { db } from "@/lib/db";
import { splitPlainTextQuotes } from "@/lib/mail/quote-utils";
import { isKnownTrackerUrl } from "@/lib/mail/tracker-detection";

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

export function dedupKey(url: URL): string {
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const query = url.search ? url.search : "";
  return url.hostname.toLowerCase() + path + query;
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
  const byKey = new Map<string, PersonLink>();
  const order: string[] = [];
  for (const message of messages) {
    if (!message.textBody) continue;
    for (const extracted of extractLinks(null, message.textBody)) {
      if (!byKey.has(extracted.key)) {
        order.push(extracted.key);
        byKey.set(extracted.key, {
          id: extracted.key,
          url: extracted.url,
          title: extracted.title,
          messageId: message.id,
          receivedAt: message.receivedAt,
        });
      }
    }
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
