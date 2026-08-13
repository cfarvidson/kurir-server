import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

/**
 * Build a redirect URL using the public-facing base URL.
 * Behind Tailscale Serve → kamal-proxy, the app sees HTTP but the browser is on HTTPS.
 * Using req.nextUrl directly would generate http:// redirects, dropping the user
 * out of the TLS tunnel. NEXTAUTH_URL reflects the real browser-facing origin.
 */
function redirect(
  req: Parameters<Parameters<typeof auth>[0]>[0],
  path: string,
) {
  const base = process.env.NEXTAUTH_URL || req.nextUrl.origin;
  return NextResponse.redirect(new URL(path, base));
}

export default auth((req) => {
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
