import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { rateLimitOAuthAuthorize } from "@/lib/mcp/oauth-rate-limit";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

type ProxyRequest = Parameters<Parameters<typeof auth>[0]>[0];

/**
 * A forwarded host is trusted only when it is NEXTAUTH_URL or one of
 * KURIR_EXTRA_ORIGINS. Anything else keeps the canonical URL.
 */
function forwardedOrigin(req: ProxyRequest, base: string): string | null {
  const raw = (req.headers.get("x-forwarded-host") || "").split(",")[0].trim();
  if (!raw) return null;
  const withoutPort = raw.replace(/:\d+$/, "");
  const candidates: { hosts: string[]; origin: string }[] = [];
  const add = (value: string) => {
    try {
      const url = new URL(value);
      candidates.push({
        hosts: [url.host, url.hostname],
        origin: url.origin,
      });
    } catch {
      // Skip a malformed URL rather than trusting the forwarded host.
    }
  };
  add(base);
  for (const item of (process.env.KURIR_EXTRA_ORIGINS || "").split(",")) {
    const trimmed = item.trim();
    if (trimmed) add(trimmed);
  }
  for (const candidate of candidates) {
    if (
      candidate.hosts.includes(raw) ||
      candidate.hosts.includes(withoutPort)
    ) {
      return candidate.origin;
    }
  }
  return null;
}

/**
 * Build a redirect URL using the public-facing base URL.
 * Behind Tailscale Serve → kamal-proxy, the app sees HTTP but the browser is on HTTPS.
 * Using req.nextUrl directly would generate http:// redirects, dropping the user
 * out of the TLS tunnel. NEXTAUTH_URL reflects the real browser-facing origin.
 */
function redirect(req: ProxyRequest, path: string) {
  const base = process.env.NEXTAUTH_URL || req.nextUrl.origin;
  const origin = forwardedOrigin(req, base);
  return NextResponse.redirect(new URL(path, origin ?? base));
}

export default auth(async (req) => {
  // Pages cannot emit HTTP 429. Limit CIMD-driven authorize GETs here.
  const authorizeLimit = await rateLimitOAuthAuthorize(
    req.nextUrl.pathname,
    req.method,
    req.headers,
  );
  if (authorizeLimit) return authorizeLimit;

  const isLoggedIn = !!req.auth?.user;
  const isOnLoginPage = req.nextUrl.pathname === "/login";
  const isOnSetupPage = req.nextUrl.pathname === "/setup";
  const isOnRegisterPage = req.nextUrl.pathname === "/register";
  // Public legal pages — App Store reviewers and users must reach these
  // without an account.
  const isLegalPage = ["/privacy", "/terms", "/support"].includes(
    req.nextUrl.pathname,
  );
  // Local visual fixtures only — the pages themselves also 404 in production.
  const isDevPreview =
    process.env.NODE_ENV !== "production" &&
    req.nextUrl.pathname.startsWith("/dev/");
  const isAuthRoute = req.nextUrl.pathname.startsWith("/api/auth");
  const isSetupApi = req.nextUrl.pathname === "/api/setup/check";
  const isHealthCheck = req.nextUrl.pathname === "/api/up";
  const isUpdaterCallback =
    req.nextUrl.pathname === "/api/admin/updates/status";

  // Mobile API routes do their own bearer-token auth (no session cookie).
  const isMobileApi = req.nextUrl.pathname.startsWith("/api/mobile");
  // MCP Streamable HTTP + OAuth discovery/token are public (no session).
  // /oauth/authorize stays behind the existing login redirect.
  const isMcp =
    req.nextUrl.pathname === "/mcp" || req.nextUrl.pathname.startsWith("/mcp/");
  const isOAuthMeta =
    req.nextUrl.pathname === "/.well-known/oauth-protected-resource" ||
    req.nextUrl.pathname === "/.well-known/oauth-authorization-server";
  const isOAuthToken = req.nextUrl.pathname === "/api/oauth/token";
  // Existing routes that support dual auth (session OR bearer) validate the
  // token in the handler. Only these exact paths may bypass the session
  // check here — a blanket bearer bypass would expose any handler that
  // relied solely on the proxy for auth.
  const hasBearerToken = (req.headers.get("authorization") ?? "").startsWith(
    "Bearer ",
  );
  const isBearerApiRequest =
    hasBearerToken &&
    (/^\/api\/mail\/message\/[^/]+\/body$/.test(req.nextUrl.pathname) ||
      /^\/api\/attachments\/[^/]+$/.test(req.nextUrl.pathname) ||
      req.nextUrl.pathname === "/api/mail/send" ||
      req.nextUrl.pathname === "/api/attachments/upload" ||
      req.nextUrl.pathname === "/api/contacts/search");
  // Allow auth, setup check, health check, and updater callback routes
  if (
    isAuthRoute ||
    isSetupApi ||
    isHealthCheck ||
    isUpdaterCallback ||
    isMobileApi ||
    isMcp ||
    isOAuthMeta ||
    isOAuthToken ||
    isBearerApiRequest
  ) {
    return NextResponse.next();
  }

  // Redirect logged-in users away from login page. A `next` param (set when
  // an unauthenticated visit was bounced here) survives login — validated to
  // a same-origin path so it can't be used as an open redirect. Backslashes
  // are rejected too: WHATWG URL parsing folds "/\evil.com" into
  // protocol-relative "//evil.com".
  if (isLoggedIn && isOnLoginPage) {
    const next = req.nextUrl.searchParams.get("next");
    const dest =
      next &&
      next.startsWith("/") &&
      !next.startsWith("//") &&
      !next.includes("\\")
        ? next
        : "/imbox";
    return redirect(req, dest);
  }

  // Return 401 JSON for unauthenticated API requests (instead of redirect)
  if (!isLoggedIn && req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Redirect non-logged-in users to login, preserving the intended
  // destination so the login form can return them there afterwards.
  if (
    !isLoggedIn &&
    !isOnLoginPage &&
    !isOnSetupPage &&
    !isOnRegisterPage &&
    !isLegalPage &&
    !isDevPreview
  ) {
    const next = req.nextUrl.pathname + req.nextUrl.search;
    return redirect(req, `/login?next=${encodeURIComponent(next)}`);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|sw\\.js|.*\\.png|.*\\.svg).*)",
  ],
};
