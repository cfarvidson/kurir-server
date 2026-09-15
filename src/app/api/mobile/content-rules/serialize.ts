import { NextResponse } from "next/server";
import { z } from "zod";
import { listContentRulesForUser } from "@/lib/mail/content-rule-store";

const actionSchema = z.enum([
  "KEEP",
  "IMBOX",
  "FEED",
  "PAPER_TRAIL",
  "ARCHIVE",
]);

export const senderSchema = z.object({
  scope: z.enum(["ADDRESS", "DOMAIN", "SUBDOMAINS"]),
  scopeValue: z.string(),
  includeExisting: z.boolean(),
});

export const createRuleSchema = z.object({
  criterion: z.string(),
  onMatch: actionSchema,
  onNoMatch: actionSchema,
  emailConnectionId: z.string().nullable().optional(),
  sender: senderSchema,
});

export const patchRuleSchema = z
  .object({
    criterion: z.string().optional(),
    onMatch: actionSchema.optional(),
    onNoMatch: actionSchema.optional(),
    recheck: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.criterion !== undefined ||
      v.onMatch !== undefined ||
      v.onNoMatch !== undefined,
    { message: "Nothing to update" },
  );

export async function getRuleForUser(userId: string, ruleId: string) {
  const rules = await listContentRulesForUser(userId);
  return rules.find((rule) => rule.id === ruleId);
}

export function serializeRule(
  rule: NonNullable<Awaited<ReturnType<typeof getRuleForUser>>>,
) {
  return {
    id: rule.id,
    criterion: rule.criterion,
    onMatch: rule.onMatch,
    onNoMatch: rule.onNoMatch,
    emailConnectionId: rule.emailConnectionId,
    createdAt: rule.createdAt,
    senders: rule.senders,
    matchCount: rule._count.matches,
    matches: rule.matches.map((match) => ({
      id: match.id,
      reason: match.reason,
      createdAt: match.createdAt,
      messageId: match.message.id,
      subject: match.message.subject,
      fromAddress: match.message.fromAddress,
      fromName: match.message.fromName,
      receivedAt: match.message.receivedAt,
    })),
  };
}

/** Ownership misses are 404, validation failures 400. */
export function contentRuleErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "Invalid request";
  const status = /not found$/i.test(message) ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}
