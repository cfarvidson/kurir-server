import { NextResponse } from "next/server";
import { authenticateMcpRequest, unauthorizedResponse } from "@/lib/mcp/auth";
import { corsHeaders, corsPreflight } from "@/lib/mcp/cors";
import { dispatchMcp } from "@/lib/mcp/protocol";
import { rateLimitUser } from "@/lib/rate-limit";

const METHODS = "POST, OPTIONS";

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export function GET() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}

export async function POST(req: Request) {
  const auth = await authenticateMcpRequest(req.headers);
  if (!auth) return unauthorizedResponse();

  const limit = await rateLimitUser(auth.userId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retryAfter: limit.retryAfter },
      {
        status: 429,
        headers: {
          "Retry-After": String(limit.retryAfter),
          ...corsHeaders(METHODS),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { status: 200, headers: corsHeaders(METHODS) },
    );
  }

  const res = await dispatchMcp({
    headers: req.headers,
    body,
    userId: auth.userId,
    tokenId: auth.tokenId,
  });
  return NextResponse.json(res.json, {
    status: res.status,
    headers: corsHeaders(METHODS),
  });
}

function methodNotAllowed() {
  return new Response(null, {
    status: 405,
    headers: {
      Allow: METHODS,
      ...corsHeaders(METHODS),
    },
  });
}
