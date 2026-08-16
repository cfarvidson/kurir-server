import pkg from "@/../package.json";
import { MCP_PROTOCOL_VERSION } from "@/lib/mcp/oauth";
import { getTool, listTools } from "@/lib/mcp/tools";
import {
  readMeta,
  type JsonRpcRequest,
  type ToolContext,
  type ToolDef,
  type ToolResult,
} from "@/lib/mcp/types";

const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

export async function dispatchMcp(input: {
  headers: Headers;
  body: unknown;
  userId: string;
  tokenId: string;
}): Promise<{ status: number; json: unknown }> {
  const id = jsonRpcId(input.body);
  const version =
    input.headers.get("MCP-Protocol-Version") ??
    input.headers.get("Mcp-Protocol-Version");
  if (version !== MCP_PROTOCOL_VERSION) {
    return rpcError(
      id,
      INVALID_REQUEST,
      `Unsupported protocol version. Supported: ${MCP_PROTOCOL_VERSION}`,
    );
  }

  const request = parseJsonRpc(input.body);
  if (!request) {
    return rpcError(id, INVALID_REQUEST, "Invalid JSON-RPC request");
  }

  const headerMethod = input.headers.get("Mcp-Method");
  if (!headerMethod || headerMethod !== request.method) {
    return rpcError(
      id,
      INVALID_REQUEST,
      "Mcp-Method header is required and must equal body.method",
    );
  }

  if (request.method === "tools/call") {
    const toolName = toolNameFromParams(request.params);
    const headerName = input.headers.get("Mcp-Name");
    if (!headerName || !toolName || headerName !== toolName) {
      return rpcError(
        id,
        INVALID_REQUEST,
        "Mcp-Name header is required and must equal params.name",
      );
    }
  }

  const meta = readMeta(request.params);
  if (meta.protocolVersion && meta.protocolVersion !== MCP_PROTOCOL_VERSION) {
    return rpcError(
      id,
      INVALID_REQUEST,
      `Unsupported protocol version. Supported: ${MCP_PROTOCOL_VERSION}`,
    );
  }

  switch (request.method) {
    case "server/discover":
      // DiscoverResult per the 2026-07-28 revision: supportedVersions is
      // what clients use as evidence of a modern server; serverInfo travels
      // in the _meta envelope.
      return rpcResult(request.id, {
        supportedVersions: [MCP_PROTOCOL_VERSION],
        capabilities: { tools: {} },
        _meta: {
          "io.modelcontextprotocol/serverInfo": {
            name: "kurir",
            version: pkg.version,
          },
        },
      });
    case "tools/list":
      return rpcResult(request.id, {
        tools: listTools().map(serializeTool),
        ttlMs: 300000,
        // Tool list is the same for every user but requires a token, so
        // it must not be shared across identities.
        cacheScope: "private",
      });
    case "tools/call":
      return callTool(request, input.userId, input.tokenId, meta);
    default:
      return rpcError(
        request.id,
        METHOD_NOT_FOUND,
        `Method not found: ${request.method}`,
      );
  }
}

async function callTool(
  request: JsonRpcRequest,
  userId: string,
  tokenId: string,
  meta: ReturnType<typeof readMeta>,
): Promise<{ status: number; json: unknown }> {
  const params = asRecord(request.params);
  const name = typeof params?.name === "string" ? params.name : "";
  const tool = getTool(name);
  if (!tool) {
    return rpcError(request.id, INVALID_PARAMS, `Unknown tool: ${name}`);
  }

  const rawArgs = params?.arguments;
  const args =
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};

  const ctx: ToolContext = {
    userId,
    tokenId,
    hasElicitation: meta.clientCapabilities
      ? "elicitation" in meta.clientCapabilities
      : false,
  };
  const inputResponses = parseInputResponses(params?.inputResponses);
  if (inputResponses) ctx.inputResponses = inputResponses;
  if (typeof params?.requestState === "string") {
    ctx.requestState = params.requestState;
  }

  let result: ToolResult;
  try {
    result = await tool.handler(ctx, args);
  } catch {
    return rpcResult(request.id, toolErrorResult("Tool failed"));
  }

  if (result.type === "ok") {
    const text =
      result.text ??
      (result.structuredContent == null
        ? ""
        : JSON.stringify(result.structuredContent));
    return rpcResult(request.id, {
      content: [{ type: "text", text }],
      structuredContent: result.structuredContent,
      isError: false,
    });
  }

  if (result.type === "error") {
    return rpcResult(request.id, toolErrorResult(result.message));
  }

  return rpcResult(request.id, {
    resultType: "input_required",
    requestState: result.requestState,
    inputRequests: {
      confirm: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message: result.message,
          requestedSchema: { type: "object", properties: {} },
        },
      },
    },
  });
}

function toolErrorResult(message: string) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function serializeTool(def: ToolDef) {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    ...(def.annotations ? { annotations: def.annotations } : {}),
  };
}

function parseJsonRpc(body: unknown): JsonRpcRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const rec = body as Record<string, unknown>;
  if (rec.jsonrpc !== "2.0") return null;
  if (typeof rec.method !== "string" || rec.method.length === 0) return null;
  if (
    rec.id !== undefined &&
    rec.id !== null &&
    typeof rec.id !== "string" &&
    typeof rec.id !== "number"
  ) {
    return null;
  }
  return {
    jsonrpc: "2.0",
    id: rec.id === undefined ? null : (rec.id as string | number | null),
    method: rec.method,
    params: rec.params,
  };
}

function jsonRpcId(body: unknown): string | number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const id = (body as Record<string, unknown>).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toolNameFromParams(params: unknown): string | undefined {
  const name = asRecord(params)?.name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

function parseInputResponses(
  value: unknown,
): ToolContext["inputResponses"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: NonNullable<ToolContext["inputResponses"]> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    out[key] = {
      ...(typeof rec.action === "string" ? { action: rec.action } : {}),
      ...(rec.content !== undefined ? { content: rec.content } : {}),
    };
  }
  return out;
}

function rpcResult(
  id: string | number | null,
  result: Record<string, unknown>,
) {
  // Every 2026-07-28 result carries resultType; clients reject results
  // without it. Handlers that need input_required set it themselves.
  const withType =
    typeof result.resultType === "string"
      ? result
      : { resultType: "complete", ...result };
  return {
    status: 200,
    json: { jsonrpc: "2.0" as const, id, result: withType },
  };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return {
    status: 200,
    json: { jsonrpc: "2.0" as const, id, error: { code, message } },
  };
}
