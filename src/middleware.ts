import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
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
    return NextResponse.redirect(new URL("/imbox", req.nextUrl));
  }

  // Redirect non-logged-in users to login
  if (!isLoggedIn && !isOnLoginPage && !isOnSetupPage && !isOnRegisterPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
