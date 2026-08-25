import { z } from "zod";
import { canManageConnections } from "@/lib/auth";
import { db } from "@/lib/db";
import { approveOwnPendingSenders } from "@/lib/jobs/maintenance-tasks";
import { bulkApproveOldSendersForUser } from "@/lib/mail/mutations";
import {
  bumpSidebarCounts,
  err,
  firstZodMessage,
  ok,
  requireConfirmation,
  wrap,
} from "@/lib/mcp/tools/helpers";
import type { ToolContext, ToolDef, ToolResult } from "@/lib/mcp/types";
import { isValidTimeZone } from "@/lib/timezone";

const THEMES = ["light", "dark", "system"] as const;

const BADGE_FIELDS = [
  "showImboxBadge",
  "showScreenerBadge",
  "showFeedBadge",
  "showPaperTrailBadge",
  "showFollowUpBadge",
  "showReplyLaterBadge",
  "showScheduledBadge",
] as const;

const SETTINGS_SELECT = {
  displayName: true,
  theme: true,
  timezone: true,
  blockRemoteImages: true,
  blockTrackers: true,
  showImboxBadge: true,
  showScreenerBadge: true,
  showFeedBadge: true,
  showPaperTrailBadge: true,
  showFollowUpBadge: true,
  showReplyLaterBadge: true,
  showScheduledBadge: true,
} as const;

const updateSettingsSchema = z.object({
  displayName: z.string().optional(),
  theme: z.enum(THEMES).optional(),
  timezone: z.string().optional(),
  blockRemoteImages: z.boolean().optional(),
  blockTrackers: z.boolean().optional(),
  showImboxBadge: z.boolean().optional(),
  showScreenerBadge: z.boolean().optional(),
  showFeedBadge: z.boolean().optional(),
  showPaperTrailBadge: z.boolean().optional(),
  showFollowUpBadge: z.boolean().optional(),
  showReplyLaterBadge: z.boolean().optional(),
  showScheduledBadge: z.boolean().optional(),
});

const updateConnectionSchema = z.object({
  connectionId: z.string().min(1),
  displayName: z.string().optional(),
  isDefault: z.boolean().optional(),
  sendAsEmail: z.string().email().nullable().optional(),
  aliases: z.array(z.string().email()).optional(),
  treatDomainAsOwn: z.boolean().optional(),
});

const deleteConnectionSchema = z.object({
  connectionId: z.string().min(1),
});

const revokePasskeySchema = z.object({
  passkeyId: z.string().min(1),
});

const bulkApproveSchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
});

const CONNECTION_SAFE_SELECT = {
  id: true,
  email: true,
  displayName: true,
  imapHost: true,
  imapPort: true,
  smtpHost: true,
  smtpPort: true,
  sendAsEmail: true,
  aliases: true,
  treatDomainAsOwn: true,
  isDefault: true,
  oauthProvider: true,
  createdAt: true,
} as const;

export function registerSettingsTools(
  registerTool: (def: ToolDef) => void,
): void {
  registerTool({
    name: "get_settings",
    description:
      "Read the signed-in user's display name, theme, timezone, image/tracker policy, and badge preferences.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    handler: wrap(getSettings),
  });

  registerTool({
    name: "update_settings",
    description:
      "Update displayName, theme, timezone, blockRemoteImages, blockTrackers, or badge booleans. Only provided keys change.",
    inputSchema: {
      type: "object",
      properties: {
        displayName: { type: "string" },
        theme: { type: "string", enum: [...THEMES] },
        timezone: { type: "string" },
        blockRemoteImages: { type: "boolean" },
        blockTrackers: { type: "boolean" },
        showImboxBadge: { type: "boolean" },
        showScreenerBadge: { type: "boolean" },
        showFeedBadge: { type: "boolean" },
        showPaperTrailBadge: { type: "boolean" },
        showFollowUpBadge: { type: "boolean" },
        showReplyLaterBadge: { type: "boolean" },
        showScheduledBadge: { type: "boolean" },
      },
    },
    handler: wrap(updateSettings),
  });

  registerTool({
    name: "list_connections",
    description:
      "List the user's email connections. Never returns passwords or OAuth tokens.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    handler: wrap(listConnections),
  });

  registerTool({
    name: "update_connection",
    description:
      "Update displayName, isDefault, sendAsEmail, aliases, or treatDomainAsOwn. Honors self-service connection management.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string" },
        displayName: { type: "string" },
        isDefault: { type: "boolean" },
        sendAsEmail: { type: ["string", "null"] },
        aliases: { type: "array", items: { type: "string" } },
        treatDomainAsOwn: { type: "boolean" },
      },
      required: ["connectionId"],
    },
    handler: wrap(updateConnection),
  });

  registerTool({
    name: "list_passkeys",
    description:
      "List the user's passkeys (id, friendly name, createdAt). Never returns credential material.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    handler: wrap(listPasskeys),
  });

  registerTool({
    name: "delete_connection",
    description:
      "Delete an email connection. Refuses the last connection. Requires client elicitation.",
    inputSchema: {
      type: "object",
      properties: { connectionId: { type: "string" } },
      required: ["connectionId"],
    },
    annotations: { destructiveHint: true },
    handler: wrap(deleteConnection),
  });

  registerTool({
    name: "revoke_passkey",
    description:
      "Revoke a passkey. Refuses the last passkey. Requires client elicitation.",
    inputSchema: {
      type: "object",
      properties: { passkeyId: { type: "string" } },
      required: ["passkeyId"],
    },
    annotations: { destructiveHint: true },
    handler: wrap(revokePasskey),
  });

  registerTool({
    name: "bulk_approve_old_senders",
    description:
      "Approve PENDING senders whose newest mail is older than days (default 90) into Imbox. Requires client elicitation.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: 365 } },
    },
    annotations: { destructiveHint: true },
    handler: wrap(bulkApproveOldSenders),
  });
}

async function getSettings(
  ctx: ToolContext,
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  const user = await db.user.findUnique({
    where: { id: ctx.userId },
    select: SETTINGS_SELECT,
  });
  if (!user) return err("not found or not yours");
  return ok(user);
}

async function updateSettings(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = updateSettingsSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));

  const data: Record<string, unknown> = {};

  if (parsed.data.displayName !== undefined) {
    const trimmed = parsed.data.displayName.trim();
    if (!trimmed) return err("Display name cannot be empty");
    if (trimmed.length > 100) return err("Display name too long");
    data.displayName = trimmed;
  }
  if (parsed.data.theme !== undefined) data.theme = parsed.data.theme;
  if (parsed.data.timezone !== undefined) {
    if (!isValidTimeZone(parsed.data.timezone)) {
      return err("Invalid timezone");
    }
    data.timezone = parsed.data.timezone;
  }
  if (parsed.data.blockRemoteImages !== undefined) {
    data.blockRemoteImages = parsed.data.blockRemoteImages;
  }
  if (parsed.data.blockTrackers !== undefined) {
    data.blockTrackers = parsed.data.blockTrackers;
  }

  let badgesChanged = false;
  for (const field of BADGE_FIELDS) {
    if (parsed.data[field] !== undefined) {
      data[field] = parsed.data[field];
      badgesChanged = true;
    }
  }

  if (Object.keys(data).length === 0) {
    return err("No settings to update");
  }

  const user = await db.user.update({
    where: { id: ctx.userId },
    data,
    select: SETTINGS_SELECT,
  });
  if (badgesChanged) bumpSidebarCounts();
  return ok(user);
}

async function listConnections(
  ctx: ToolContext,
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  const rows = await db.emailConnection.findMany({
    where: { userId: ctx.userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: CONNECTION_SAFE_SELECT,
  });
  return ok({
    items: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}

async function updateConnection(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = updateConnectionSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));

  if (!(await canManageConnections(ctx.userId))) {
    return err("Account management is disabled. Contact your admin.");
  }

  const connection = await db.emailConnection.findFirst({
    where: { id: parsed.data.connectionId, userId: ctx.userId },
    select: { id: true },
  });
  if (!connection) return err("not found or not yours");

  const {
    connectionId,
    displayName,
    isDefault,
    sendAsEmail,
    aliases,
    treatDomainAsOwn,
  } = parsed.data;

  if (isDefault) {
    await db.emailConnection.updateMany({
      where: { userId: ctx.userId, isDefault: true, NOT: { id: connectionId } },
      data: { isDefault: false },
    });
  }

  const updated = await db.emailConnection.update({
    where: { id: connectionId },
    data: {
      ...(displayName !== undefined && { displayName }),
      ...(sendAsEmail !== undefined && { sendAsEmail }),
      ...(aliases !== undefined && { aliases }),
      ...(isDefault !== undefined && { isDefault }),
      ...(treatDomainAsOwn !== undefined && { treatDomainAsOwn }),
    },
    select: CONNECTION_SAFE_SELECT,
  });

  if (
    sendAsEmail !== undefined ||
    aliases !== undefined ||
    treatDomainAsOwn !== undefined
  ) {
    try {
      const approved = await approveOwnPendingSenders(ctx.userId);
      if (approved > 0) bumpSidebarCounts();
    } catch (error) {
      console.error(`[mcp] own-sender sweep error for ${ctx.userId}:`, error);
    }
  }

  return ok({
    ...updated,
    createdAt: updated.createdAt.toISOString(),
  });
}

async function listPasskeys(
  ctx: ToolContext,
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  const rows = await db.passkey.findMany({
    where: { userId: ctx.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      friendlyName: true,
      createdAt: true,
    },
  });
  return ok({
    items: rows.map((row) => ({
      id: row.id,
      friendlyName: row.friendlyName,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}

async function deleteConnection(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = deleteConnectionSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));

  if (!(await canManageConnections(ctx.userId))) {
    return err("Account management is disabled. Contact your admin.");
  }

  const connection = await db.emailConnection.findFirst({
    where: { id: parsed.data.connectionId, userId: ctx.userId },
    select: { id: true, email: true, isDefault: true },
  });
  if (!connection) return err("not found or not yours");

  const count = await db.emailConnection.count({
    where: { userId: ctx.userId },
  });
  if (count <= 1) {
    return err("Cannot remove your only email connection.");
  }

  return requireConfirmation(
    ctx,
    "delete_connection",
    parsed.data,
    `Delete connection ${connection.email}`,
    async () => {
      await db.$transaction(async (tx) => {
        const remaining = await tx.emailConnection.count({
          where: { userId: ctx.userId },
        });
        if (remaining <= 1) {
          throw new Error("Cannot remove your only email connection.");
        }
        await tx.emailConnection.delete({ where: { id: connection.id } });
        if (connection.isDefault) {
          const next = await tx.emailConnection.findFirst({
            where: { userId: ctx.userId },
            orderBy: { createdAt: "asc" },
          });
          if (next) {
            await tx.emailConnection.update({
              where: { id: next.id },
              data: { isDefault: true },
            });
          }
        }
      });
      return ok({ ok: true, connectionId: connection.id });
    },
  );
}

async function revokePasskey(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = revokePasskeySchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));

  const passkey = await db.passkey.findFirst({
    where: { id: parsed.data.passkeyId, userId: ctx.userId },
    select: { id: true, friendlyName: true },
  });
  if (!passkey) return err("not found or not yours");

  const count = await db.passkey.count({ where: { userId: ctx.userId } });
  if (count <= 1) {
    return err(
      "Cannot delete the last passkey. You would lose access to your account.",
    );
  }

  const label = passkey.friendlyName?.trim() || passkey.id;
  return requireConfirmation(
    ctx,
    "revoke_passkey",
    parsed.data,
    `Revoke passkey ${label}`,
    async () => {
      const deleted = await db.$transaction(async (tx) => {
        const remaining = await tx.passkey.count({
          where: { userId: ctx.userId },
        });
        if (remaining <= 1) return null;
        return tx.passkey.delete({ where: { id: passkey.id } });
      });
      if (!deleted) {
        return err(
          "Cannot delete the last passkey. You would lose access to your account.",
        );
      }
      return ok({ ok: true, passkeyId: passkey.id });
    },
  );
}

async function bulkApproveOldSenders(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = bulkApproveSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const days = parsed.data.days ?? 90;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const count = await db.sender.count({
    where: {
      userId: ctx.userId,
      status: "PENDING",
      messages: {
        some: {},
        none: { receivedAt: { gte: cutoff } },
      },
    },
  });

  return requireConfirmation(
    ctx,
    "bulk_approve_old_senders",
    parsed.data,
    `Approve ${count} old sender${count === 1 ? "" : "s"} (older than ${days} days) into Imbox`,
    async () => {
      const approved = await bulkApproveOldSendersForUser(ctx.userId, days);
      if (approved > 0) bumpSidebarCounts();
      return ok({ approved, days });
    },
  );
}

