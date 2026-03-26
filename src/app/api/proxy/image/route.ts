import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import dns from "dns/promises";

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
  if (normalized.startsWith("fe80")) return true; // fe80::/10 (link-local)

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
 * Resolve hostname via DNS and check that the resolved IP is not private/loopback.
 * Returns true if the hostname resolves to a blocked IP.
 */
async function resolvesToPrivateIP(hostname: string): Promise<boolean> {
  // If it's already an IP literal, check directly
  if (isPrivateIP(hostname)) return true;

  try {
    const { address } = await dns.lookup(hostname);
    return isPrivateIP(address);
  } catch {
    // DNS resolution failed — block to be safe
    return true;
  }
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

    // DNS resolution check to block rebinding/IPv6 bypass
    if (await resolvesToPrivateIP(parsed.hostname)) {
      return transparentPixelResponse();
    }

    const response = await fetch(parsed.href, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "KurirMail/1.0 ImageProxy" },
      redirect: "manual",
    });

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
        if (await resolvesToPrivateIP(redirectUrl.hostname)) {
          return transparentPixelResponse();
        }
        // Disallow further redirects after the first validated one
        finalResponse = await fetch(redirectUrl.href, {
          signal: AbortSignal.timeout(10_000),
          headers: { "User-Agent": "KurirMail/1.0 ImageProxy" },
          redirect: "error",
        });
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
