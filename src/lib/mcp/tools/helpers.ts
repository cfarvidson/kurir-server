import { revalidateTag } from "next/cache";
import { z } from "zod";
import {
  consumeConfirmation,
  createConfirmation,
} from "@/lib/mcp/confirmations";
import type { ToolContext, ToolDef, ToolResult } from "@/lib/mcp/types";

export const CANNOT_CONFIRM =
  "this client cannot show a confirmation prompt; retry the same call with confirm: true";
export const CONFIRM_MISMATCH = "confirmation does not match arguments";
export const CONFIRM_CANCELLED = "cancelled";
export const DEMO_SEND_DISABLED = "Sending is disabled on this demo instance.";

export function wrap(
  handler: (
    ctx: ToolContext,
    args: Record<string, unknown>,
  ) => Promise<ToolResult>,
): ToolDef["handler"] {
  return async (ctx, args) => {
    try {
      if (args.confirm === true) ctx.confirmed = true;
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
 * MRTR gate for dangerous tools. No elicitation -> error, unless the
 * same call set confirm: true (clients that cannot show elicitation/create).
 * A client that can elicit still gets the prompt, even if confirm is set.
 * First call creates a confirmation and returns input_required. A retry with
 * requestState consumes the handle: accept runs `onAccept` once, cancel
 * and mismatch return errors and do not mutate.
 */
export async function requireConfirmation(
  ctx: ToolContext,
  toolName: string,
  args: unknown,
  message: string,
  onAccept: () => Promise<ToolResult>,
): Promise<ToolResult> {
  if (!ctx.hasElicitation) {
    if (ctx.confirmed) return onAccept();
    return err(CANNOT_CONFIRM);
  }
  if (!ctx.requestState) {
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
  const outcome = await consumeConfirmation({
    id: ctx.requestState,
    userId: ctx.userId,
    tokenId: ctx.tokenId,
    toolName,
    args,
    action: ctx.inputResponses?.confirm?.action,
  });
  if (outcome === "mismatch") return err(CONFIRM_MISMATCH);
  if (outcome === "cancel") return err(CONFIRM_CANCELLED);
  return onAccept();
}
