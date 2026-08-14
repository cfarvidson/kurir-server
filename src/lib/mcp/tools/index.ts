import type { ToolDef } from "@/lib/mcp/types";

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
