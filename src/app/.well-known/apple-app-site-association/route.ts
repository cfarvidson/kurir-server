import { NextResponse } from "next/server";

/**
 * GET /.well-known/apple-app-site-association
 *
 * Lets iOS associate the Kurir app with this domain so native passkey
 * (webcredentials) prompts work against the server's WebAuthn RP ID.
 *
 * APPLE_APP_IDS: comma-separated "TEAMID.bundle.id" values. Route 404s when
 * unset so self-hosted instances without the iOS app expose nothing.
 */
export async function GET() {
  const appIds = (process.env.APPLE_APP_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (appIds.length === 0) {
    return NextResponse.json({ error: "Not configured" }, { status: 404 });
  }

  return NextResponse.json(
    {
      webcredentials: { apps: appIds },
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
