import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";

// VAPID keys can be auto-generated at runtime (see generate-secrets.ts), so the
// public key must be read at request time rather than inlined at build time.
export const dynamic = "force-dynamic";

export async function GET() {
  const { vapid } = getConfig();

  if (!vapid.configured) {
    return NextResponse.json(
      { error: "Push notifications are not configured on this server" },
      { status: 503 },
    );
  }

  return NextResponse.json({ publicKey: vapid.publicKey });
}
