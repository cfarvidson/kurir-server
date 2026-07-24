import { NextResponse } from "next/server";
import {
  MOBILE_API_VERSION,
  MIN_SUPPORTED_APP_API_VERSION,
} from "@/lib/mobile/version";
import pkg from "../../../../../package.json";

/**
 * GET /api/mobile/meta
 *
 * Version handshake for native clients. Read before login (no auth — the
 * proxy already lets /api/mobile through), so the app can tell the user
 * "update the server" or "update the app" instead of failing opaquely.
 * Servers without this endpoint predate the handshake and are treated as
 * apiVersion 1 by clients.
 */
export async function GET() {
  return NextResponse.json(
    {
      apiVersion: MOBILE_API_VERSION,
      minSupportedAppApiVersion: MIN_SUPPORTED_APP_API_VERSION,
      serverVersion: pkg.version,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
