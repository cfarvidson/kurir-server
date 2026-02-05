import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isOnLoginPage = req.nextUrl.pathname === "/login";
  const isOnSetupPage = req.nextUrl.pathname === "/setup";
  const isAuthRoute = req.nextUrl.pathname.startsWith("/api/auth");

  // Allow auth routes
  if (isAuthRoute) {
    return NextResponse.next();
  }

  // Redirect logged-in users away from login page
  if (isLoggedIn && isOnLoginPage) {
    return NextResponse.redirect(new URL("/imbox", req.nextUrl));
  }

  // Redirect non-logged-in users to login
  if (!isLoggedIn && !isOnLoginPage && !isOnSetupPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

// Use Node.js runtime to support IMAP verification
export const runtime = "nodejs";
