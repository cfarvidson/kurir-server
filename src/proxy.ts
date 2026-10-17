import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { rateLimitOAuthAuthorize } from "@/lib/mcp/oauth-rate-limit";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

// Next may include basePath in pathname. new URL("/login", base) also drops
// a path on NEXTAUTH_URL, so login and OAuth metadata would miss the mount.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");

function appPath(pathname: string): string {
  if (
    basePath &&
    (pathname === basePath || pathname.startsWith(`${basePath}/`))
  ) {
    const rest = pathname.slice(basePath.length);
    return rest.startsWith("/") ? rest : "/";
  }
  return pathname;
}

function withBasePath(path: string): string {
  if (!basePath) return path;
  const q = path.indexOf("?");
  const pathname = q === -1 ? path : path.slice(0, q);
  const search = q === -1 ? "" : path.slice(q);
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return path;
  if (pathname === basePath || pathname.startsWith(`${basePath}/`)) {
    return path;
  }
  return `${basePath}${pathname}${search}`;
}

/**
 * Build a redirect URL using the public-facing base URL.
 * Behind Tailscale Serve → kamal-proxy, the app sees HTTP but the browser is on HTTPS.
 * Using req.nextUrl directly would generate http:// redirects, dropping the user
 * out of the TLS tunnel. NEXTAUTH_URL reflects the real browser-facing origin.
 * Its origin is used so a path on that URL is not parsed away.
 */
function redirect(
  req: Parameters<Parameters<typeof auth>[0]>[0],
  path: string,
) {
  const base = process.env.NEXTAUTH_URL || req.nextUrl.origin;
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    origin = req.nextUrl.origin;
  }
  return NextResponse.redirect(new URL(withBasePath(path), origin));
}

export default auth(async (req) => {
  const pathname = appPath(req.nextUrl.pathname);

  // Pages cannot emit HTTP 429. Limit CIMD-driven authorize GETs here.
  const authorizeLimit = await rateLimitOAuthAuthorize(
    pathname,
    req.method,
    req.headers,
  );
  if (authorizeLimit) return authorizeLimit;

  const isLoggedIn = !!req.auth?.user;
  const isOnLoginPage = pathname === "/login";
  const isOnSetupPage = pathname === "/setup";
  const isOnRegisterPage = pathname === "/register";
  // Public legal pages — App Store reviewers and users must reach these
  // without an account.
  const isLegalPage = ["/privacy", "/terms", "/support"].includes(
    pathname,
  );
  // Local visual fixtures only — the pages themselves also 404 in production.
  const isDevPreview =
    process.env.NODE_ENV !== "production" &&
    pathname.startsWith("/dev/");
  const isAuthRoute = pathname.startsWith("/api/auth");
  const isSetupApi = pathname === "/api/setup/check";
  const isHealthCheck = pathname === "/api/up";
  const isUpdaterCallback =
    pathname === "/api/admin/updates/status";

  // Mobile API routes do their own bearer-token auth (no session cookie).
  const isMobileApi = pathname.startsWith("/api/mobile");
  // MCP Streamable HTTP + OAuth discovery/token are public (no session).
  // /oauth/authorize stays behind the existing login redirect.
  const isMcp =
    pathname === "/mcp" || pathname.startsWith("/mcp/");
  const isOAuthMeta =
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname === "/.well-known/oauth-authorization-server";
  const isOAuthToken = pathname === "/api/oauth/token";
  // Existing routes that support dual auth (session OR bearer) validate the
  // token in the handler. Only these exact paths may bypass the session
  // check here — a blanket bearer bypass would expose any handler that
  // relied solely on the proxy for auth.
  const hasBearerToken = (req.headers.get("authorization") ?? "").startsWith(
    "Bearer ",
  );
  const isBearerApiRequest =
    hasBearerToken &&
    (/^\/api\/mail\/message\/[^/]+\/body$/.test(pathname) ||
      /^\/api\/attachments\/[^/]+$/.test(pathname) ||
      pathname === "/api/mail/send" ||
      pathname === "/api/attachments/upload" ||
      pathname === "/api/contacts/search");
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
  if (!isLoggedIn && pathname.startsWith("/api/")) {
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
    const next = pathname + req.nextUrl.search;
    return redirect(req, `/login?next=${encodeURIComponent(next)}`);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|sw\\.js|.*\\.png|.*\\.svg).*)",
  ],
};
