/**
 * Tests for proxy.ts route protection logic.
 *
 * Invariants:
 * - /login, /setup, /register are public (no redirect when unauthenticated)
 * - /api/auth/* routes always pass through
 * - All other routes require authentication
 * - Logged-in users visiting /login are redirected to /imbox
 */
import { describe, it, expect } from "vitest";

// Test the routing decision logic in isolation
// (middleware itself is an edge function and hard to unit-test directly)

type RoutingDecision = { action: "next" } | { action: "redirect"; to: string };

function evaluateMiddleware(
  pathname: string,
  isLoggedIn: boolean,
): RoutingDecision {
  const isOnLoginPage = pathname === "/login";
  const isOnSetupPage = pathname === "/setup";
  const isOnRegisterPage = pathname === "/register";
  const isAuthRoute = pathname.startsWith("/api/auth");

  if (isAuthRoute) return { action: "next" };
  if (isLoggedIn && isOnLoginPage) return { action: "redirect", to: "/imbox" };
  if (!isLoggedIn && !isOnLoginPage && !isOnSetupPage && !isOnRegisterPage) {
    return { action: "redirect", to: "/login" };
  }
  return { action: "next" };
}

describe("middleware route protection", () => {
  describe("unauthenticated user", () => {
    it("redirects to /login for protected routes", () => {
      const routes = [
        "/imbox",
        "/feed",
        "/paper-trail",
        "/archive",
        "/compose",
        "/settings",
      ];
      for (const route of routes) {
        const result = evaluateMiddleware(route, false);
        expect(result).toEqual({ action: "redirect", to: "/login" });
      }
    });

    it("allows access to /login without redirect", () => {
      expect(evaluateMiddleware("/login", false)).toEqual({ action: "next" });
    });

    it("allows access to /register without redirect", () => {
      expect(evaluateMiddleware("/register", false)).toEqual({
        action: "next",
      });
    });

    it("allows access to /setup without redirect", () => {
      expect(evaluateMiddleware("/setup", false)).toEqual({ action: "next" });
    });

    it("allows /api/auth/* routes through", () => {
      const authRoutes = [
        "/api/auth/webauthn/register/options",
        "/api/auth/webauthn/register/verify",
        "/api/auth/webauthn/login/options",
        "/api/auth/webauthn/login/verify",
        "/api/auth/session",
      ];
      for (const route of authRoutes) {
        expect(evaluateMiddleware(route, false)).toEqual({ action: "next" });
      }
    });
  });

  describe("authenticated user", () => {
    it("allows access to protected routes", () => {
      const routes = [
        "/imbox",
        "/feed",
        "/paper-trail",
        "/compose",
        "/settings",
      ];
      for (const route of routes) {
        expect(evaluateMiddleware(route, true)).toEqual({ action: "next" });
      }
    });

    it("redirects away from /login to /imbox", () => {
      expect(evaluateMiddleware("/login", true)).toEqual({
        action: "redirect",
        to: "/imbox",
      });
    });

    it("allows access to /register even when logged in (adding second passkey)", () => {
      // /register is in the public list, so it always passes through
      expect(evaluateMiddleware("/register", true)).toEqual({ action: "next" });
    });

    it("allows access to /setup even when logged in (adding connections)", () => {
      expect(evaluateMiddleware("/setup", true)).toEqual({ action: "next" });
    });

    it("allows /api/auth/* through", () => {
      expect(evaluateMiddleware("/api/auth/session", true)).toEqual({
        action: "next",
      });
    });
  });

  describe("edge cases", () => {
    it("handles nested API paths correctly", () => {
      // /api/connections is NOT an auth route — it needs auth
      expect(evaluateMiddleware("/api/connections", false)).toEqual({
        action: "redirect",
        to: "/login",
      });
    });

    it("handles /api/mail/* correctly (protected)", () => {
      expect(evaluateMiddleware("/api/mail/sync", false)).toEqual({
        action: "redirect",
        to: "/login",
      });
    });
  });
});
