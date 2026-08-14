import { revalidateTag } from "next/cache";
import { z } from "zod";
import { createConfirmation } from "@/lib/mcp/confirmations";
import type { ToolContext, ToolDef, ToolResult } from "@/lib/mcp/types";

const CANNOT_CONFIRM = "this client cannot confirm this action";

export function wrap(
  handler: (
    ctx: ToolContext,
    args: Record<string, unknown>,
  ) => Promise<ToolResult>,
): ToolDef["handler"] {
  return async (ctx, args) => {
    try {
      return await handler(ctx, args);
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Tool failed";
      return {
        type: "error",
        message: /not found/i.test(raw) ? "not found or not yours" : raw,
      };
    }
  };
}

export function firstZodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid arguments";
}

export function ok(structuredContent: unknown, text?: string): ToolResult {
  return { type: "ok", structuredContent, ...(text ? { text } : {}) };
}

export function err(message: string): ToolResult {
  return { type: "error", message };
}

export function bumpSidebarCounts(): void {
  revalidateTag("sidebar-counts", { expire: 0 });
}

/**
 * Task 7 stub for MRTR tools. Task 8 consumes the handle and runs the
 * mutation. Until then: no elicitation -> error; first call -> input_required.
 */
export async function stubConfirmation(
  ctx: ToolContext,
  toolName: string,
  args: unknown,
  message: string,
): Promise<ToolResult> {
  if (!ctx.hasElicitation) {
    return err(CANNOT_CONFIRM);
  }
  if (ctx.requestState) {
    return err(CANNOT_CONFIRM);
  }
  const created = await createConfirmation({
    userId: ctx.userId,
    tokenId: ctx.tokenId,
    toolName,
    args,
  });
  return {
    type: "input_required",
    requestState: created.id,
    message,
  };
}
