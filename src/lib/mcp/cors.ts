/**
 * CORS for browser MCP clients (Claude.ai). No cookies, so `*` is correct.
 */
export function corsHeaders(methods: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
  };
}

export function corsPreflight(methods: string): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(methods),
  });
}
