import { NextResponse } from "next/server";
import { corsHeaders, corsPreflight } from "@/lib/mcp/cors";
import { protectedResourceMetadata } from "@/lib/mcp/oauth";

const METHODS = "GET, OPTIONS";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export function GET() {
  return NextResponse.json(protectedResourceMetadata(), {
    headers: {
      ...corsHeaders(METHODS),
      "Cache-Control": "public, max-age=300",
    },
  });
}
