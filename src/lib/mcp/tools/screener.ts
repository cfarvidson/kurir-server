import { z } from "zod";
import { db } from "@/lib/db";
import { patternMatchesDomain } from "@/lib/mail/domain-rules";
import {
  approveSenderForUser,
  changeDomainRuleCategoryForUser,
  changeSenderCategoryForUser,
  createDomainRuleForUser,
  deleteDomainRuleForUser,
  listDomainRulesForUser,
  setSenderAllowImagesForUser,
  setSenderUnthreadForUser,
  skipSenderForUser,
  undoScreenActionForUser,
  unskipSenderForUser,
} from "@/lib/mail/mutations";
import {
  bumpSidebarCounts,
  err,
  firstZodMessage,
  ok,
  stubConfirmation,
  wrap,
} from "@/lib/mcp/tools/helpers";
import type { ToolContext, ToolDef, ToolResult } from "@/lib/mcp/types";

const CATEGORIES = ["IMBOX", "FEED", "PAPER_TRAIL"] as const;
const SCREEN_ACTIONS = ["approve", "skip", "unskip", "undo", "reject"] as const;

const screenSenderSchema = z.object({
  senderId: z.string().min(1),
  action: z.enum(SCREEN_ACTIONS),
  category: z.enum(CATEGORIES).optional(),
});

const updateSenderSchema = z.object({
  senderId: z.string().min(1),
  category: z.enum(CATEGORIES).optional(),
  unthread: z.boolean().optional(),
  allowImages: z.boolean().optional(),
});

const createDomainRuleSchema = z
  .object({
    senderId: z.string().min(1).optional(),
    pattern: z.string().min(1).optional(),
    includeSubdomains: z.boolean(),
    status: z.enum(["APPROVED", "REJECTED"]),
    category: z.enum(CATEGORIES).optional(),
  })
  .refine((v) => Boolean(v.senderId || v.pattern), {
    message: "senderId or pattern is required",
  });

const updateDomainRuleSchema = z.object({
  ruleId: z.string().min(1),
  category: z.enum(CATEGORIES),
});

const deleteDomainRuleSchema = z.object({
  ruleId: z.string().min(1),
});

export function registerScreenerTools(
  registerTool: (def: ToolDef) => void,
): void {
  registerTool({
    name: "screen_sender",
    description:
      "Approve, skip, unskip, undo, or reject a screener sender. Reject requires client elicitation.",
    inputSchema: {
      type: "object",
      properties: {
        senderId: { type: "string" },
        action: { type: "string", enum: [...SCREEN_ACTIONS] },
        category: { type: "string", enum: [...CATEGORIES] },
      },
      required: ["senderId", "action"],
    },
    annotations: { destructiveHint: true },
    handler: wrap(screenSender),
  });

  registerTool({
    name: "update_sender",
    description:
      "Change an approved sender's category, unthread flag, or image allowlist.",
    inputSchema: {
      type: "object",
      properties: {
        senderId: { type: "string" },
        category: { type: "string", enum: [...CATEGORIES] },
        unthread: { type: "boolean" },
        allowImages: { type: "boolean" },
      },
      required: ["senderId"],
    },
    handler: wrap(updateSender),
  });

  registerTool({
    name: "list_domain_rules",
    description: "List the user's domain screening rules.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    handler: wrap(listDomainRules),
  });

  registerTool({
    name: "create_domain_rule",
    description:
      "Create a domain screening rule. APPROVED runs immediately; REJECTED requires elicitation.",
    inputSchema: {
      type: "object",
      properties: {
        senderId: { type: "string" },
        pattern: { type: "string" },
        includeSubdomains: { type: "boolean" },
        status: { type: "string", enum: ["APPROVED", "REJECTED"] },
        category: { type: "string", enum: [...CATEGORIES] },
      },
      required: ["includeSubdomains", "status"],
    },
    annotations: { destructiveHint: true },
    handler: wrap(createDomainRule),
  });

  registerTool({
    name: "update_domain_rule",
    description: "Change the category of an existing domain rule.",
    inputSchema: {
      type: "object",
      properties: {
        ruleId: { type: "string" },
        category: { type: "string", enum: [...CATEGORIES] },
      },
      required: ["ruleId", "category"],
    },
    handler: wrap(updateDomainRule),
  });

  registerTool({
    name: "delete_domain_rule",
    description:
      "Delete a domain rule. Existing sender decisions are kept; new senders from the domain return to the screener.",
    inputSchema: {
      type: "object",
      properties: { ruleId: { type: "string" } },
      required: ["ruleId"],
    },
    handler: wrap(deleteDomainRule),
  });
}

async function screenSender(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = screenSenderSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const { senderId, action, category } = parsed.data;

  if (action === "reject") {
    const sender = await db.sender.findFirst({
      where: { id: senderId, userId: ctx.userId },
      select: { email: true, displayName: true },
    });
    if (!sender) return err("not found or not yours");
    const name = sender.displayName?.trim();
    const summary = name
      ? `Reject sender ${name} <${sender.email}>`
      : `Reject sender ${sender.email}`;
    return stubConfirmation(ctx, "screen_sender", args, summary);
  }

  if (action === "approve") {
    if (!category) return err("category is required for approve");
    await approveSenderForUser(ctx.userId, senderId, category);
  } else if (action === "skip") {
    await skipSenderForUser(ctx.userId, senderId);
  } else if (action === "unskip") {
    await unskipSenderForUser(ctx.userId, senderId);
  } else {
    await undoScreenActionForUser(ctx.userId, senderId);
  }

  bumpSidebarCounts();
  return ok({ ok: true, senderId, action });
}

async function updateSender(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = updateSenderSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const { senderId, category, unthread, allowImages } = parsed.data;
  if (
    category === undefined &&
    unthread === undefined &&
    allowImages === undefined
  ) {
    return err("Provide category, unthread, or allowImages");
  }
  if (category !== undefined) {
    await changeSenderCategoryForUser(ctx.userId, senderId, category);
  }
  if (unthread !== undefined) {
    await setSenderUnthreadForUser(ctx.userId, senderId, unthread);
  }
  if (allowImages !== undefined) {
    await setSenderAllowImagesForUser(ctx.userId, senderId, allowImages);
  }
  if (category !== undefined) bumpSidebarCounts();
  return ok({ ok: true, senderId });
}

async function listDomainRules(
  ctx: ToolContext,
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  const rules = await listDomainRulesForUser(ctx.userId);
  return ok({
    items: rules.map((rule) => ({
      ...rule,
      createdAt: rule.createdAt.toISOString(),
    })),
  });
}

async function createDomainRule(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = createDomainRuleSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const { includeSubdomains, status, category } = parsed.data;

  if (status === "REJECTED") {
    const pattern = parsed.data.pattern ?? "(sender domain)";
    return stubConfirmation(
      ctx,
      "create_domain_rule",
      args,
      `Reject domain ${includeSubdomains ? "*." : ""}${pattern}`,
    );
  }

  if (!category) return err("category is required for approve rules");

  const resolved = await resolveDomainRuleSender(
    ctx.userId,
    parsed.data.senderId,
    parsed.data.pattern,
    includeSubdomains,
  );
  const rule = await createDomainRuleForUser(ctx.userId, {
    senderId: resolved.senderId,
    pattern: resolved.pattern,
    includeSubdomains,
    status: "APPROVED",
    category,
  });
  bumpSidebarCounts();
  return ok({
    id: rule.id,
    pattern: rule.pattern,
    includeSubdomains: rule.includeSubdomains,
    status: rule.status,
    category: rule.category,
  });
}

async function updateDomainRule(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = updateDomainRuleSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  await changeDomainRuleCategoryForUser(
    ctx.userId,
    parsed.data.ruleId,
    parsed.data.category,
  );
  bumpSidebarCounts();
  return ok({ ok: true, ruleId: parsed.data.ruleId });
}

async function deleteDomainRule(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = deleteDomainRuleSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  await deleteDomainRuleForUser(ctx.userId, parsed.data.ruleId);
  bumpSidebarCounts();
  return ok({ ok: true, ruleId: parsed.data.ruleId });
}

async function resolveDomainRuleSender(
  userId: string,
  senderId: string | undefined,
  pattern: string | undefined,
  includeSubdomains: boolean,
): Promise<{ senderId: string; pattern: string }> {
  if (senderId) {
    const sender = await db.sender.findFirst({
      where: { id: senderId, userId },
      select: { id: true, domain: true },
    });
    if (!sender) throw new Error("not found or not yours");
    return { senderId: sender.id, pattern: pattern ?? sender.domain };
  }
  if (!pattern) throw new Error("senderId or pattern is required");
  const senders = await db.sender.findMany({
    where: { userId },
    select: { id: true, domain: true },
  });
  const match = senders.find((s) =>
    patternMatchesDomain(s.domain, { pattern, includeSubdomains }),
  );
  if (!match) throw new Error("not found or not yours");
  return { senderId: match.id, pattern };
}
