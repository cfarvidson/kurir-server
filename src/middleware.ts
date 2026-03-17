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
function redirect(req: Parameters<Parameters<typeof auth>[0]>[0], path: string) {
  const base = process.env.NEXTAUTH_URL || req.nextUrl.origin;
  return NextResponse.redirect(new URL(path, base));
}

export default auth((req) => {
  const isLoggedIn = !!req.auth?.user;
  const isOnLoginPage = req.nextUrl.pathname === "/login";
  const isOnSetupPage = req.nextUrl.pathname === "/setup";
  const isOnRegisterPage = req.nextUrl.pathname === "/register";
  const isAuthRoute = req.nextUrl.pathname.startsWith("/api/auth");
  const isHealthCheck = req.nextUrl.pathname === "/api/up";

  // Allow auth and health check routes
  if (isAuthRoute || isHealthCheck) {
    return NextResponse.next();
  }

  // Redirect logged-in users away from login page
  if (isLoggedIn && isOnLoginPage) {
    return redirect(req, "/imbox");
  }

  // Redirect non-logged-in users to login
  if (!isLoggedIn && !isOnLoginPage && !isOnSetupPage && !isOnRegisterPage) {
    return redirect(req, "/login");
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.png|.*\\.svg).*)"],
};
