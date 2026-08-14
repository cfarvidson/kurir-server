import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import dns from "dns/promises";
import http from "http";
import https from "https";
import net from "net";

const BLOCKED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const BLOCKED_SUFFIXES = [".local", ".internal", ".ts.net"];

const TRANSPARENT_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAApgAAAKYB3X3/OAAAABJQREFUCB1jYGBg+A8EDAAEJgFNlT3VvQAAAABJRU5ErkJggg==",
  "base64",
);

function transparentPixelResponse() {
  return new NextResponse(TRANSPARENT_PIXEL, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

function isBlockedHostname(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;
  if (BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s))) return true;
  // Block private IP ranges used as hostnames
  if (isPrivateIP(hostname)) return true;
  return false;
}

function isPrivateIP(ip: string): boolean {
  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — extract the IPv4 portion
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1]);

  // Plain IPv4
  if (isPrivateIPv4(ip)) return true;

  // IPv6 loopback and private ranges
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // fc00::/7 (ULA)
  // fe80::/10 is fe80-febf, not just the fe80 prefix
  if (/^fe[89ab]/i.test(normalized)) return true;
  // Hex IPv4-mapped (::ffff:7f00:1 = 127.0.0.1)
  const v4hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (v4hex) {
    const hi = parseInt(v4hex[1], 16);
    const lo = parseInt(v4hex[2], 16);
    return isPrivateIPv4(
      `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`,
    );
  }

  return false;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

/**
 * Resolve every A/AAAA record. Returns a pinned public address, or null when
 * any record is private / lookup fails (block to be safe).
 */
async function resolvePublicAddress(hostname: string): Promise<string | null> {
  if (isPrivateIP(hostname)) return null;

  try {
    const results = await dns.lookup(hostname, { all: true });
    if (results.length === 0) return null;
    if (results.some((r) => isPrivateIP(r.address))) return null;
    return results[0].address;
  } catch {
    return null;
  }
}

function fetchPinned(
  url: URL,
  ip: string,
  redirect: "manual" | "error",
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;
    const family = net.isIP(ip) === 6 ? 6 : 4;
    const req = lib.request(
      {
        host: ip,
        servername: url.hostname,
        port: Number(url.port) || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Host: url.host,
          "User-Agent": "KurirMail/1.0 ImageProxy",
        },
        lookup: (_hostname, _options, cb) => {
          cb(null, ip, family);
        },
        timeout: 10_000,
      },
      (res) => {
        if (
          redirect === "error" &&
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400
        ) {
          req.destroy();
          reject(new Error("redirect"));
          return;
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            res.on("data", (chunk: Buffer) => {
              controller.enqueue(new Uint8Array(chunk));
            });
            res.on("end", () => controller.close());
            res.on("error", (err) => controller.error(err));
          },
        });
        resolve(
          new Response(stream, {
            status: res.statusCode ?? 502,
            headers,
          }),
        );
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

async function bufferWithLimit(
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Buffer | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) return null;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function proxyImageResponse(
  contentType: string,
  content: Buffer,
): NextResponse {
  return new NextResponse(new Uint8Array(content), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(content.length),
      "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse(null, { status: 401 });
  }

  const url = req.nextUrl.searchParams.get("url");
  if (!url || !/^https?:\/\//i.test(url)) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";

    if (isBlockedHostname(parsed.hostname)) {
      return transparentPixelResponse();
    }

    const pinnedIp = await resolvePublicAddress(parsed.hostname);
    if (!pinnedIp) {
      return transparentPixelResponse();
    }

    const response = await fetchPinned(parsed, pinnedIp, "manual");

    // Follow one redirect manually, validating the target
    let finalResponse = response;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return transparentPixelResponse();
      try {
        const redirectUrl = new URL(location, parsed.href);
        if (isBlockedHostname(redirectUrl.hostname)) {
          return transparentPixelResponse();
        }
        if (!/^https?:$/i.test(redirectUrl.protocol)) {
          return transparentPixelResponse();
        }
        const redirectIp = await resolvePublicAddress(redirectUrl.hostname);
        if (!redirectIp) {
          return transparentPixelResponse();
        }
        finalResponse = await fetchPinned(redirectUrl, redirectIp, "error");
      } catch {
        return transparentPixelResponse();
      }
    }

    if (!finalResponse.ok || !finalResponse.body) {
      return transparentPixelResponse();
    }

    const contentType =
      finalResponse.headers.get("content-type") || "image/png";

    // Block SVG (can contain scripts)
    if (contentType.includes("svg")) {
      return transparentPixelResponse();
    }

    // Only proxy image content types
    if (!contentType.startsWith("image/")) {
      return transparentPixelResponse();
    }

    // Buffer the response body up to MAX_IMAGE_SIZE (don't trust Content-Length)
    const content = await bufferWithLimit(finalResponse.body, MAX_IMAGE_SIZE);
    if (!content) {
      return transparentPixelResponse();
    }

    return proxyImageResponse(contentType, content);
  } catch {
    return transparentPixelResponse();
  }
}
