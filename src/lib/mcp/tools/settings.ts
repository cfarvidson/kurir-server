import { z } from "zod";
import { canManageConnections } from "@/lib/auth";
import { db } from "@/lib/db";
import { approveOwnPendingSenders } from "@/lib/jobs/maintenance-tasks";
import {
  bumpSidebarCounts,
  err,
  firstZodMessage,
  ok,
  wrap,
} from "@/lib/mcp/tools/helpers";
import type { ToolContext, ToolDef, ToolResult } from "@/lib/mcp/types";

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

function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
