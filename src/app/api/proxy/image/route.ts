import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
]);
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
  const parts = hostname.split(".").map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p))) {
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254)
    );
  }
  return false;
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

function proxyImageResponse(response: Response): NextResponse {
  if (!response.ok || !response.body) {
    return transparentPixelResponse();
  }

  const contentType = response.headers.get("content-type") || "image/png";

  // Block SVG (can contain scripts)
  if (contentType.includes("svg")) {
    return transparentPixelResponse();
  }

  // Only proxy image content types
  if (!contentType.startsWith("image/")) {
    return transparentPixelResponse();
  }

  // Block oversized responses
  const contentLength = parseInt(
    response.headers.get("content-length") || "0",
    10,
  );
  if (contentLength > MAX_IMAGE_SIZE) {
    return transparentPixelResponse();
  }

  return new NextResponse(response.body, {
    headers: {
      "Content-Type": contentType,
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

    const response = await fetch(parsed.href, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "KurirMail/1.0 ImageProxy" },
      redirect: "manual",
    });

    // Follow redirects manually, validating each target
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
        const redirectResponse = await fetch(redirectUrl.href, {
          signal: AbortSignal.timeout(10_000),
          headers: { "User-Agent": "KurirMail/1.0 ImageProxy" },
          redirect: "follow",
        });
        return proxyImageResponse(redirectResponse);
      } catch {
        return transparentPixelResponse();
      }
    }

    return proxyImageResponse(response);
  } catch {
    return transparentPixelResponse();
  }
}
