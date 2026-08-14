import { corsHeaders } from "@/lib/mcp/cors";
import { MCP_SCOPE, mcpIssuer, mcpResourceUri } from "@/lib/mcp/oauth";
import { verifyMcpAccessToken } from "@/lib/mcp/tokens";

export async function authenticateMcpRequest(
  headers: Headers,
): Promise<{ userId: string; tokenId: string } | null> {
  const header = headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  return verifyMcpAccessToken(token, mcpResourceUri());
}

export function unauthorizedResponse(): Response {
  const metadata = `${mcpIssuer()}/.well-known/oauth-protected-resource`;
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${metadata}", scope="${MCP_SCOPE}"`,
      ...corsHeaders("POST, OPTIONS"),
    },
  });
}
