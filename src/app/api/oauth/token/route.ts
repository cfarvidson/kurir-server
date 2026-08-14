import { NextResponse } from "next/server";
import { corsHeaders, corsPreflight } from "@/lib/mcp/cors";
import {
  consumeAuthorizationCode,
  fetchCimd,
  mcpResourceUri,
  verifyPkce,
} from "@/lib/mcp/oauth";
import { oauthClientIp } from "@/lib/mcp/oauth-rate-limit";
import { issueMcpTokens, rotateMcpTokens } from "@/lib/mcp/tokens";
import { rateLimitOAuth } from "@/lib/rate-limit";

const METHODS = "POST, OPTIONS";
const ACCESS_EXPIRES_IN = 3600;

function formField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function tokenError(
  error: string,
  description: string,
  status: number,
  extra?: Record<string, string>,
) {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: { ...corsHeaders(METHODS), ...extra } },
  );
}

function tokenResponse(tokens: { accessToken: string; refreshToken: string }) {
  return NextResponse.json(
    {
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_EXPIRES_IN,
      refresh_token: tokens.refreshToken,
    },
    { headers: corsHeaders(METHODS) },
  );
}

export function OPTIONS() {
  return corsPreflight(METHODS);
}

export async function POST(req: Request) {
  const limit = await rateLimitOAuth(oauthClientIp(req.headers));
  if (!limit.allowed) {
    return tokenError("invalid_request", "Too many requests", 429, {
      "Retry-After": String(limit.retryAfter),
    });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return tokenError("invalid_request", "Invalid form body", 400);
  }

  const grantType = formField(form, "grant_type");
  if (grantType === "authorization_code") {
    return authorizationCodeGrant(form);
  }
  if (grantType === "refresh_token") {
    return refreshTokenGrant(form);
  }
  return tokenError(
    "unsupported_grant_type",
    "grant_type must be authorization_code or refresh_token",
    400,
  );
}

async function authorizationCodeGrant(form: FormData) {
  const code = formField(form, "code");
  const redirectUri = formField(form, "redirect_uri");
  const clientId = formField(form, "client_id");
  const codeVerifier = formField(form, "code_verifier");
  const resource = formField(form, "resource");

  if (!code || !redirectUri || !clientId || !codeVerifier || !resource) {
    return tokenError(
      "invalid_request",
      "Missing required token request parameters",
      400,
    );
  }

  const consumed = await consumeAuthorizationCode({
    code,
    clientId,
    redirectUri,
    resource,
  });
  if (!consumed) {
    return tokenError(
      "invalid_grant",
      "Authorization code is invalid or expired",
      400,
    );
  }

  if (!verifyPkce(codeVerifier, consumed.codeChallenge)) {
    return tokenError("invalid_grant", "PKCE verification failed", 400);
  }

  const doc = await fetchCimd(clientId);
  const tokens = await issueMcpTokens({
    userId: consumed.userId,
    clientId,
    clientName: doc?.client_name ?? null,
    resource,
  });

  return tokenResponse(tokens);
}

async function refreshTokenGrant(form: FormData) {
  const refreshToken = formField(form, "refresh_token");
  const resource = formField(form, "resource");

  if (!refreshToken || !resource) {
    return tokenError(
      "invalid_request",
      "Missing required token request parameters",
      400,
    );
  }

  const tokens = await rotateMcpTokens(refreshToken, resource);
  if (!tokens) {
    return tokenError(
      "invalid_grant",
      "Refresh token is invalid or already rotated",
      400,
    );
  }

  return tokenResponse(tokens);
}
