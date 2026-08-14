export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface McpRequestMeta {
  protocolVersion?: string;
  clientCapabilities?: { elicitation?: unknown };
}

export interface ToolContext {
  userId: string;
  tokenId: string;
  hasElicitation: boolean;
  inputResponses?: Record<string, { action?: string; content?: unknown }>;
  requestState?: string;
}

export type ToolResult =
  | { type: "ok"; structuredContent: unknown; text?: string }
  | { type: "error"; message: string }
  | {
      type: "input_required";
      requestState: string;
      message: string;
    };

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
  handler: (
    ctx: ToolContext,
    args: Record<string, unknown>,
  ) => Promise<ToolResult>;
}

const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";

export function readMeta(params: unknown): McpRequestMeta {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return {};
  }
  const meta = (params as Record<string, unknown>)._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return {};
  }
  const rec = meta as Record<string, unknown>;
  const protocolVersion = rec[PROTOCOL_VERSION_KEY];
  const clientCapabilities = rec[CLIENT_CAPABILITIES_KEY];
  const result: McpRequestMeta = {};
  if (typeof protocolVersion === "string") {
    result.protocolVersion = protocolVersion;
  }
  if (
    clientCapabilities &&
    typeof clientCapabilities === "object" &&
    !Array.isArray(clientCapabilities)
  ) {
    result.clientCapabilities = clientCapabilities as {
      elicitation?: unknown;
    };
  }
  return result;
}
