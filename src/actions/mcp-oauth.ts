"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createAuthorizationCode,
  fetchCimd,
  mcpIssuer,
  mcpResourceUri,
  redirectUriAllowed,
} from "@/lib/mcp/oauth";

function oauthRedirect(redirectUri: string, params: URLSearchParams): never {
  const url = new URL(redirectUri);
  params.forEach((value, key) => {
    url.searchParams.set(key, value);
  });
  redirect(url.toString());
}

export async function submitMcpConsent(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) {
    return "You must be signed in to connect an app.";
  }

  const decision = String(formData.get("decision") ?? "");
  const clientId = String(formData.get("client_id") ?? "");
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const codeChallenge = String(formData.get("code_challenge") ?? "");
  const resource = String(formData.get("resource") ?? "");
  const stateRaw = formData.get("state");
  const state =
    typeof stateRaw === "string" && stateRaw.length > 0 ? stateRaw : undefined;

  if (!clientId || !redirectUri || !codeChallenge || !resource) {
    return "This authorization request is missing required parameters.";
  }

  if (resource !== mcpResourceUri()) {
    return "This authorization request is not valid for this Kurir instance.";
  }

  const doc = await fetchCimd(clientId);
  if (!doc) {
    return "This app could not be verified. The client metadata document is missing or invalid.";
  }
  if (!redirectUriAllowed(doc, redirectUri)) {
    return "This app requested a redirect that is not allowed.";
  }

  try {
    // Reject values that are not absolute URLs before any redirect.
    new URL(redirectUri);
  } catch {
    return "This app requested a redirect that is not allowed.";
  }

  const params = new URLSearchParams();
  params.set("iss", mcpIssuer());
  if (state) params.set("state", state);

  if (decision === "deny") {
    params.set("error", "access_denied");
    oauthRedirect(redirectUri, params);
  }

  if (decision !== "approve") {
    return "This authorization request is missing required parameters.";
  }

  const code = await createAuthorizationCode({
    userId: session.user.id,
    clientId,
    redirectUri,
    codeChallenge,
    resource,
  });
  params.set("code", code);
  oauthRedirect(redirectUri, params);
}
