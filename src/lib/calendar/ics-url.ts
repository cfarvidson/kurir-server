/**
 * Canonicalise a public ICS URL, refuse private destinations, and GET the
 * feed over HTTPS. Shared by connect and the ICS adapter.
 */
import { lookup } from "node:dns/promises";
import net from "node:net";
import ICAL from "ical.js";
import { fetchPinned } from "@/lib/calendar/ics-pinned";

export const ICS_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const NOT_ALLOWED = "That URL is not allowed.";
const NO_LOGIN =
  "This path has no login. Use CalDAV for a calendar that needs a username and password.";

export function canonicalizeIcsUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("A calendar URL is required");
  const rewritten = trimmed
    .replace(/^webcals:\/\//i, "https://")
    .replace(/^webcal:\/\//i, "https://")
    .replace(/^http:\/\//i, "https://");
  let parsed: URL;
  try {
    parsed = new URL(rewritten);
  } catch {
    throw new Error("That is not a calendar URL.");
  }
  if (parsed.username || parsed.password) {
    throw new Error(NO_LOGIN);
  }
  if (parsed.protocol !== "https:") {
    throw new Error("That is not a calendar URL.");
  }
  return parsed.href.replace(/\/+$/, "");
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0]! << 24) | (nums[1]! << 16) | (nums[2]! << 8) | nums[3]!) >>> 0;
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a == null || b == null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

export function icsAddressIsBlocked(address: string): boolean {
  const lower = address.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return icsAddressIsBlocked(mapped[1]!);
  if (ipv4ToInt(address) != null) {
    return (
      inCidr(address, "127.0.0.0", 8) ||
      inCidr(address, "10.0.0.0", 8) ||
      inCidr(address, "172.16.0.0", 12) ||
      inCidr(address, "192.168.0.0", 16) ||
      inCidr(address, "169.254.0.0", 16) ||
      inCidr(address, "0.0.0.0", 8) ||
      inCidr(address, "224.0.0.0", 4)
    );
  }
  if (lower === "::1" || lower === "::") return true;
  if (
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  ) {
    return true;
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  return false;
}

async function assertPublicHttpsUrl(url: URL): Promise<string> {
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(url.username || url.password ? NO_LOGIN : NOT_ALLOWED);
  }
  if (icsAddressIsBlocked(url.hostname)) {
    throw new Error(NOT_ALLOWED);
  }
  if (net.isIP(url.hostname)) {
    return url.hostname;
  }
  try {
    const answers = await lookup(url.hostname, { all: true });
    const list = Array.isArray(answers) ? answers : [answers];
    if (list.length === 0 || list.some((row) => icsAddressIsBlocked(row.address))) {
      throw new Error(NOT_ALLOWED);
    }
    return list[0]!.address;
  } catch (err) {
    if (err instanceof Error && err.message === NOT_ALLOWED) throw err;
    throw new Error("Could not reach that calendar.");
  }
}

async function readCappedBody(res: Response): Promise<string> {
  const len = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(len) && len > ICS_MAX_BYTES) {
    throw new Error("That calendar is too large.");
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > ICS_MAX_BYTES) {
      await reader.cancel();
      throw new Error("That calendar is too large.");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchIcsFeed(
  url: string,
  conditional?: { etag: string | null; lastModified: string | null },
): Promise<{
  status: number;
  body: string;
  etag: string | null;
  lastModified: string | null;
}> {
  let current = new URL(url);
  let pinnedIp = await assertPublicHttpsUrl(current);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const headers: Record<string, string> = {
      Accept: "text/calendar, text/plain, */*",
    };
    if (hop === 0 && conditional?.etag) {
      headers["If-None-Match"] = conditional.etag;
    }
    if (hop === 0 && conditional?.lastModified) {
      headers["If-Modified-Since"] = conditional.lastModified;
    }
    let res: Response;
    try {
      res = await fetchPinned(
        current,
        pinnedIp,
        hop === 0 ? "manual" : "error",
        headers,
      );
    } catch (err) {
      if (err instanceof Error && err.message === "redirect") {
        throw new Error("Could not reach that calendar.");
      }
      throw err;
    }
    if (res.status === 304) {
      return {
        status: 304,
        body: "",
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
      };
    }
    if (res.status >= 300 && res.status < 400) {
      if (hop > 0) throw new Error("Could not reach that calendar.");
      const location = res.headers.get("location");
      if (!location) throw new Error("Could not reach that calendar.");
      current = new URL(location, current);
      pinnedIp = await assertPublicHttpsUrl(current);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(NO_LOGIN);
    }
    if (!res.ok) throw new Error("Could not reach that calendar.");
    return {
      status: res.status,
      body: await readCappedBody(res),
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
    };
  }
  throw new Error("Could not reach that calendar.");
}

export function parseIcsCalendarName(body: string, fallbackHost: string): string {
  try {
    const vcalendar = new ICAL.Component(ICAL.parse(body));
    if (vcalendar.name !== "vcalendar") {
      throw new Error("not vcalendar");
    }
    const calname =
      vcalendar.getFirstPropertyValue("x-wr-calname") ??
      vcalendar.getFirstPropertyValue("name");
    if (typeof calname === "string" && calname.trim()) return calname.trim();
    return fallbackHost;
  } catch (err) {
    if (err instanceof Error && err.message === "not vcalendar") {
      throw new Error("That URL is not a calendar.");
    }
    throw new Error("That URL is not a calendar.");
  }
}
