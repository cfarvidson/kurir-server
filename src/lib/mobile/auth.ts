import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { verifyAccessToken } from "./tokens";

/**
 * Extract the bearer token from an Authorization header, if present.
 */
function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Bearer-only auth for /api/mobile/* routes. Returns the userId or null.
 */
export async function requireMobileAuth(
  req: NextRequest,
): Promise<{ userId: string } | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const verified = await verifyAccessToken(token);
  return verified ? { userId: verified.userId } : null;
}

/**
 * Dual auth for existing API routes shared between web and mobile: accepts
 * either a NextAuth session cookie or a mobile bearer token. Returns the
 * userId or null.
 */
export async function getRequestUserId(
  req: NextRequest,
): Promise<string | null> {
  const token = bearerToken(req);
  if (token) {
    const verified = await verifyAccessToken(token);
    return verified?.userId ?? null;
  }
  const session = await auth();
  return session?.user?.id ?? null;
}
