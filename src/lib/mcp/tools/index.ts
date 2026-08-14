import type { ToolDef } from "@/lib/mcp/types";
import { registerContactTools } from "@/lib/mcp/tools/contacts";
import { registerMailTools } from "@/lib/mcp/tools/mail";
import { registerScreenerTools } from "@/lib/mcp/tools/screener";
import { registerSendTools } from "@/lib/mcp/tools/send";
import { registerSettingsTools } from "@/lib/mcp/tools/settings";

const tools = new Map<string, ToolDef>();

export function registerTool(def: ToolDef): void {
  tools.set(def.name, def);
}

export function listTools(): ToolDef[] {
  return [...tools.values()];
}

export function getTool(name: string): ToolDef | undefined {
  return tools.get(name);
}

registerMailTools(registerTool);
registerSendTools(registerTool);
registerScreenerTools(registerTool);
registerContactTools(registerTool);
registerSettingsTools(registerTool);
