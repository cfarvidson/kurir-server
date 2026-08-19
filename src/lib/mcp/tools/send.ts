import { DraftType } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { isDemoInstance } from "@/lib/demo";
import { convertMarkdownToEmailHtml } from "@/lib/mail/markdown-to-email";
import {
  deliverScheduledNowForUser,
  insertScheduledMessageForUser,
} from "@/lib/mail/scheduled-messages";
import { sendMailForUser } from "@/lib/mail/send";
import { getOwnAddresses, isOwnAddress } from "@/lib/mail/user-emails";
import {
  DEMO_SEND_DISABLED,
  err,
  firstZodMessage,
  ok,
  requireConfirmation,
  wrap,
} from "@/lib/mcp/tools/helpers";
import type { ToolContext, ToolDef, ToolResult } from "@/lib/mcp/types";
import { rateLimitSend } from "@/lib/rate-limit";

const MODES = ["compose", "reply", "reply_all", "forward"] as const;

const addressList = z.array(z.string().email());

const sendMailSchema = z
  .object({
    mode: z.enum(MODES),
    connectionId: z.string().min(1).optional(),
    messageId: z.string().min(1).optional(),
    to: addressList.optional(),
    cc: addressList.optional(),
    bcc: addressList.optional(),
    subject: z.string().optional(),
    body: z.string(),
    attachmentIds: z.array(z.string()).optional(),
    draft: z
      .object({
        type: z.nativeEnum(DraftType),
        contextMessageId: z.string().min(1),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode !== "compose" && !value.messageId) {
      ctx.addIssue({
        code: "custom",
        path: ["messageId"],
        message: "messageId is required for reply / reply_all / forward",
      });
    }
  });

const scheduleMailSchema = sendMailSchema.and(
  z.object({ scheduledFor: z.string().min(1) }),
);

const sendScheduledNowSchema = z.object({
  id: z.string().min(1),
});

type SendMailArgs = z.infer<typeof sendMailSchema>;

export function registerSendTools(registerTool: (def: ToolDef) => void): void {
  registerTool({
    name: "send_mail",
    description:
      "Send mail (compose, reply, reply-all, or forward). Requires client elicitation. If this send came from save_draft, pass draft { type, contextMessageId } so the draft is deleted after a successful send.",
    inputSchema: sendInputSchemaJson(false),
    annotations: { destructiveHint: true, openWorldHint: true },
    handler: wrap(sendMail),
  });

  registerTool({
    name: "schedule_mail",
    description:
      "Schedule mail for later. Same fields as send_mail plus scheduledFor. Requires client elicitation.",
    inputSchema: sendInputSchemaJson(true),
    annotations: { destructiveHint: true, openWorldHint: true },
    handler: wrap(scheduleMail),
  });

  registerTool({
    name: "send_scheduled_now",
    description:
      "Send a pending scheduled message immediately. Requires client elicitation.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    annotations: { destructiveHint: true, openWorldHint: true },
    handler: wrap(sendScheduledNow),
  });
}

function sendInputSchemaJson(includeSchedule: boolean) {
  return {
    type: "object",
    properties: {
      mode: { type: "string", enum: [...MODES] },
      connectionId: { type: "string" },
      messageId: { type: "string" },
      to: { type: "array", items: { type: "string" } },
      cc: { type: "array", items: { type: "string" } },
      bcc: { type: "array", items: { type: "string" } },
      subject: { type: "string" },
      body: { type: "string" },
      attachmentIds: { type: "array", items: { type: "string" } },
      draft: {
        type: "object",
        description:
          "Draft this send came from (same key as save_draft); deleted after a successful send",
        properties: {
          type: { type: "string", enum: ["NEW", "REPLY", "FORWARD"] },
          contextMessageId: { type: "string" },
        },
        required: ["type", "contextMessageId"],
      },
      ...(includeSchedule
        ? { scheduledFor: { type: "string", description: "ISO-8601 datetime" } }
        : {}),
    },
    required: includeSchedule
      ? ["mode", "body", "scheduledFor"]
      : ["mode", "body"],
  };
}

async function sendMail(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (isDemoInstance()) return err(DEMO_SEND_DISABLED);
  const parsed = sendMailSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));

  const resolved = await resolveOutgoing(ctx.userId, parsed.data);
  const limited = await denyIfSendLimited(ctx);
  if (limited) return limited;
  return requireConfirmation(
    ctx,
    "send_mail",
    parsed.data,
    formatSendSummary(resolved),
    async () => {
      const latest = await resolveOutgoing(ctx.userId, parsed.data);
      const sent = await sendMailForUser(ctx.userId, toSendInput(latest));
      if (
        (parsed.data.mode === "reply" || parsed.data.mode === "reply_all") &&
        latest.contextMessageId
      ) {
        await db.message.update({
          where: { id: latest.contextMessageId },
          data: { isAnswered: true },
        });
      }
      return ok({ ok: true, messageId: sent.messageId });
    },
  );
}

async function scheduleMail(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (isDemoInstance()) return err(DEMO_SEND_DISABLED);
  const parsed = scheduleMailSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));

  const resolved = await resolveOutgoing(ctx.userId, parsed.data);
  const limited = await denyIfSendLimited(ctx);
  if (limited) return limited;
  return requireConfirmation(
    ctx,
    "schedule_mail",
    parsed.data,
    formatSendSummary(resolved),
    async () => {
      const latest = await resolveOutgoing(ctx.userId, parsed.data);
      if (!latest.fromConnectionId) {
        return err(
          "No email connection found. Please add an email account in settings.",
        );
      }
      const converted = convertMarkdownToEmailHtml(parsed.data.body);
      const created = await insertScheduledMessageForUser(ctx.userId, {
        to: joinAddresses(latest.to) ?? "",
        cc: joinAddresses(latest.cc),
        bcc: joinAddresses(latest.bcc),
        subject: latest.subject ?? "",
        textBody: parsed.data.body,
        htmlBody: converted.emailHtml,
        scheduledFor: parsed.data.scheduledFor,
        emailConnectionId: latest.fromConnectionId,
        inReplyToMessageId: latest.inReplyTo,
        references: latest.references?.join(" "),
        attachmentIds: parsed.data.attachmentIds,
      });
      return ok({
        id: created.id,
        scheduledFor: created.scheduledFor.toISOString(),
      });
    },
  );
}

async function sendScheduledNow(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (isDemoInstance()) return err(DEMO_SEND_DISABLED);
  const parsed = sendScheduledNowSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));

  const msg = await db.scheduledMessage.findFirst({
    where: { id: parsed.data.id, userId: ctx.userId },
    select: { id: true, to: true, subject: true },
  });
  if (!msg) return err("not found or not yours");

  const limited = await denyIfSendLimited(ctx);
  if (limited) return limited;
  return requireConfirmation(
    ctx,
    "send_scheduled_now",
    parsed.data,
    `Send scheduled message ${msg.id} now\nTo: ${msg.to}\nSubject: ${msg.subject}`,
    async () => {
      await deliverScheduledNowForUser(ctx.userId, parsed.data.id);
      return ok({ ok: true, id: parsed.data.id });
    },
  );
}

async function denyIfSendLimited(ctx: ToolContext): Promise<ToolResult | null> {
  if (ctx.requestState && ctx.inputResponses?.confirm?.action === "accept") {
    const rl = await rateLimitSend(ctx.userId);
    if (!rl.allowed) {
      return err(
        `Too many messages sent — try again in ${rl.retryAfter} seconds`,
      );
    }
  }
  return null;
}

type ResolvedOutgoing = {
  mode: SendMailArgs["mode"];
  from: string;
  fromConnectionId?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body: string;
  scheduledFor?: string;
  inReplyTo?: string;
  references?: string[];
  contextMessageId?: string;
  attachmentIds?: string[];
  draft?: { type: DraftType; contextMessageId: string };
};

async function resolveOutgoing(
  userId: string,
  data: SendMailArgs & { scheduledFor?: string },
): Promise<ResolvedOutgoing> {
  let to = data.to;
  let cc = data.cc;
  let subject = data.subject;
  let fromConnectionId = data.connectionId;
  let inReplyTo: string | undefined;
  let references: string[] | undefined;
  let contextMessageId: string | undefined;

  if (data.mode !== "compose") {
    if (!data.messageId) {
      throw new Error("messageId is required for reply / reply_all / forward");
    }
    const message = await db.message.findFirst({
      where: { id: data.messageId, userId },
      select: {
        id: true,
        messageId: true,
        references: true,
        subject: true,
        fromAddress: true,
        replyTo: true,
        toAddresses: true,
        ccAddresses: true,
        emailConnectionId: true,
      },
    });
    if (!message) throw new Error("not found or not yours");
    contextMessageId = message.id;
    fromConnectionId = data.connectionId ?? message.emailConnectionId;
    const replyTo = message.replyTo || message.fromAddress;
    if (!to?.length) {
      to = replyTo ? [replyTo] : [];
    }
    if (data.mode === "reply_all" && data.cc === undefined) {
      const own = await getOwnAddresses(userId);
      const skip = new Set(to.map((addr) => addr.toLowerCase()));
      cc = [...message.toAddresses, ...message.ccAddresses].filter((addr) => {
        const key = addr.trim().toLowerCase();
        if (!key || skip.has(key) || isOwnAddress(addr, own)) return false;
        skip.add(key);
        return true;
      });
    }
    if (subject === undefined) {
      subject = defaultSubject(data.mode, message.subject);
    }
    if (message.messageId) {
      inReplyTo = message.messageId;
      references = [...(message.references || [])];
      if (!references.includes(message.messageId)) {
        references.push(message.messageId);
      }
    }
  }

  const connection = await loadFromConnection(userId, fromConnectionId);
  if (!connection) {
    throw new Error(
      "No email connection found. Please add an email account in settings.",
    );
  }

  return {
    mode: data.mode,
    from: connection.sendAsEmail || connection.email,
    fromConnectionId: connection.id,
    to,
    cc,
    bcc: data.bcc,
    subject,
    body: data.body,
    scheduledFor: data.scheduledFor,
    inReplyTo,
    references,
    contextMessageId,
    attachmentIds: data.attachmentIds,
    draft: data.draft,
  };
}

function defaultSubject(
  mode: Exclude<SendMailArgs["mode"], "compose">,
  original: string | null,
): string {
  const prefix = mode === "forward" ? "Fwd:" : "Re:";
  if (original?.startsWith(prefix)) return original;
  return `${prefix} ${original || ""}`;
}

async function loadFromConnection(
  userId: string,
  connectionId?: string,
): Promise<{
  id: string;
  email: string;
  sendAsEmail: string | null;
} | null> {
  if (connectionId) {
    return db.emailConnection.findFirst({
      where: { id: connectionId, userId },
      select: { id: true, email: true, sendAsEmail: true },
    });
  }
  const fallback = await db.emailConnection.findFirst({
    where: { userId, isDefault: true },
    select: { id: true, email: true, sendAsEmail: true },
  });
  if (fallback) return fallback;
  return db.emailConnection.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, sendAsEmail: true },
  });
}

function toSendInput(resolved: ResolvedOutgoing) {
  return {
    to: joinAddresses(resolved.to) ?? "",
    cc: joinAddresses(resolved.cc),
    bcc: joinAddresses(resolved.bcc),
    subject: resolved.subject ?? "",
    text: resolved.body,
    fromConnectionId: resolved.fromConnectionId,
    inReplyTo: resolved.inReplyTo,
    references: resolved.references,
    attachmentIds: resolved.attachmentIds,
    draft: resolved.draft,
  };
}

function joinAddresses(addresses?: string[]): string | undefined {
  if (!addresses || addresses.length === 0) return undefined;
  return addresses.join(", ");
}

function formatSendSummary(resolved: ResolvedOutgoing): string {
  const body =
    resolved.body.length > 500 ? resolved.body.slice(0, 500) : resolved.body;
  const lines = [
    `Send ${resolved.mode} from ${resolved.from}`,
    `To: ${resolved.to?.join(", ") || "(none)"}`,
  ];
  if (resolved.cc?.length) lines.push(`Cc: ${resolved.cc.join(", ")}`);
  if (resolved.bcc?.length) lines.push(`Bcc: ${resolved.bcc.join(", ")}`);
  lines.push(`Subject: ${resolved.subject ?? ""}`);
  if (resolved.scheduledFor) {
    lines.push(`Scheduled for: ${resolved.scheduledFor}`);
  }
  lines.push(`Body: ${body}`);
  return lines.join("\n");
}
