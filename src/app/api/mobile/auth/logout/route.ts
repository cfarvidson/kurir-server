import { NextRequest, NextResponse } from "next/server";
import { revokeByAccessToken } from "@/lib/mobile/tokens";

/**
 * DELETE /api/mobile/auth/logout
 *
 * Revokes the mobile session that owns the presented access token. Always
 * returns 200 — logging out with an already-dead token is not an error.
 */
export async function DELETE(req: NextRequest) {
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token) await revokeByAccessToken(token);
  }
  return NextResponse.json({ success: true });
}
