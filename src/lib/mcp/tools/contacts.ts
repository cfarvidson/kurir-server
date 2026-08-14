import { z } from "zod";
import {
  addGroupMemberForUser,
  createGroupForUser,
  listGroupsForUser,
  removeGroupMemberForUser,
  renameGroupForUser,
  setGroupDefaultTargetForUser,
} from "@/lib/mail/contact-groups";
import {
  addContactEmailForUser,
  createContactForUser,
  createContactSchema,
  getContactForUser,
  listContactsForUser,
  renameContactForUser,
} from "@/lib/mail/contacts";
import {
  err,
  firstZodMessage,
  ok,
  stubConfirmation,
  wrap,
} from "@/lib/mcp/tools/helpers";
import type { ToolContext, ToolDef, ToolResult } from "@/lib/mcp/types";

const listContactsSchema = z.object({
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().optional(),
});

const getContactSchema = z.object({
  contactId: z.string().min(1),
});

const updateContactSchema = z.object({
  contactId: z.string().min(1),
  name: z.string().optional(),
  emails: z
    .array(
      z.object({
        email: z.string().min(1),
        label: z.string().optional(),
      }),
    )
    .optional(),
});

const createGroupSchema = z.object({
  name: z.string().min(1),
  defaultTarget: z.enum(["TO", "BCC"]).optional(),
  memberContactEmailIds: z.array(z.string()).optional(),
});

const updateGroupSchema = z.object({
  groupId: z.string().min(1),
  name: z.string().optional(),
  defaultTarget: z.enum(["TO", "BCC"]).optional(),
});

const addMemberSchema = z.object({
  groupId: z.string().min(1),
  contactEmailId: z.string().min(1),
});

const removeMemberSchema = z.object({
  memberId: z.string().min(1),
});

const deleteContactSchema = z.object({
  contactId: z.string().min(1),
});

const deleteGroupSchema = z.object({
  groupId: z.string().min(1),
});

const DEFAULT_LIMIT = 50;

export function registerContactTools(
  registerTool: (def: ToolDef) => void,
): void {
  registerTool({
    name: "list_contacts",
    description: "List the user's contacts, optionally filtered by q.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        cursor: { type: "string" },
        limit: { type: "integer" },
      },
    },
    annotations: { readOnlyHint: true },
    handler: wrap(listContacts),
  });

  registerTool({
    name: "get_contact",
    description: "Fetch one contact by id, including emails.",
    inputSchema: {
      type: "object",
      properties: { contactId: { type: "string" } },
      required: ["contactId"],
    },
    annotations: { readOnlyHint: true },
    handler: wrap(getContact),
  });

  registerTool({
    name: "search_contacts",
    description: "Search contacts by name or email.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        cursor: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["q"],
    },
    annotations: { readOnlyHint: true },
    handler: wrap(searchContactsTool),
  });

  registerTool({
    name: "create_contact",
    description: "Create a contact with a name and at least one email.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        emails: {
          type: "array",
          items: {
            type: "object",
            properties: {
              email: { type: "string" },
              label: { type: "string" },
            },
            required: ["email"],
          },
        },
      },
      required: ["name", "emails"],
    },
    handler: wrap(createContact),
  });

  registerTool({
    name: "update_contact",
    description: "Rename a contact and/or add emails.",
    inputSchema: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        name: { type: "string" },
        emails: {
          type: "array",
          items: {
            type: "object",
            properties: {
              email: { type: "string" },
              label: { type: "string" },
            },
            required: ["email"],
          },
        },
      },
      required: ["contactId"],
    },
    handler: wrap(updateContact),
  });

  registerTool({
    name: "delete_contact",
    description: "Delete a contact. Requires client elicitation.",
    inputSchema: {
      type: "object",
      properties: { contactId: { type: "string" } },
      required: ["contactId"],
    },
    annotations: { destructiveHint: true },
    handler: wrap(deleteContact),
  });

  registerTool({
    name: "list_contact_groups",
    description: "List contact groups with members.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    handler: wrap(listGroups),
  });

  registerTool({
    name: "create_contact_group",
    description: "Create a contact group with an optional default target.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        defaultTarget: { type: "string", enum: ["TO", "BCC"] },
        memberContactEmailIds: { type: "array", items: { type: "string" } },
      },
      required: ["name"],
    },
    handler: wrap(createGroup),
  });

  registerTool({
    name: "update_contact_group",
    description: "Rename a contact group and/or change its default target.",
    inputSchema: {
      type: "object",
      properties: {
        groupId: { type: "string" },
        name: { type: "string" },
        defaultTarget: { type: "string", enum: ["TO", "BCC"] },
      },
      required: ["groupId"],
    },
    handler: wrap(updateGroup),
  });

  registerTool({
    name: "delete_contact_group",
    description: "Delete a contact group. Requires client elicitation.",
    inputSchema: {
      type: "object",
      properties: { groupId: { type: "string" } },
      required: ["groupId"],
    },
    annotations: { destructiveHint: true },
    handler: wrap(deleteGroup),
  });

  registerTool({
    name: "add_group_member",
    description: "Add a contact email to a group.",
    inputSchema: {
      type: "object",
      properties: {
        groupId: { type: "string" },
        contactEmailId: { type: "string" },
      },
      required: ["groupId", "contactEmailId"],
    },
    handler: wrap(addMember),
  });

  registerTool({
    name: "remove_group_member",
    description: "Remove a member from a contact group.",
    inputSchema: {
      type: "object",
      properties: { memberId: { type: "string" } },
      required: ["memberId"],
    },
    handler: wrap(removeMember),
  });
}

async function listContacts(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = listContactsSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  return pageContacts(
    ctx.userId,
    parsed.data.q,
    parsed.data.cursor,
    parsed.data.limit,
  );
}

async function searchContactsTool(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = listContactsSchema
    .extend({ q: z.string().min(1) })
    .safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  return pageContacts(
    ctx.userId,
    parsed.data.q,
    parsed.data.cursor,
    parsed.data.limit,
  );
}

async function pageContacts(
  userId: string,
  q: string | undefined,
  cursor: string | undefined,
  limitRaw: number | undefined,
): Promise<ToolResult> {
  const limit =
    limitRaw && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), DEFAULT_LIMIT)
      : DEFAULT_LIMIT;
  const all = await listContactsForUser(userId);
  const query = q?.trim().toLowerCase();
  const filtered = query
    ? all.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.emails.some((e) => e.email.toLowerCase().includes(query)),
      )
    : all;
  const start = cursor ? filtered.findIndex((c) => c.id === cursor) + 1 : 0;
  const startClamped = start < 0 ? 0 : start;
  const page = filtered.slice(startClamped, startClamped + limit);
  const last = page[page.length - 1];
  const nextCursor =
    page.length === limit && last && startClamped + limit < filtered.length
      ? last.id
      : undefined;
  return {
    type: "ok",
    structuredContent: nextCursor
      ? { items: page.map(serializeContact), nextCursor }
      : { items: page.map(serializeContact) },
  };
}

async function getContact(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = getContactSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const contact = await getContactForUser(ctx.userId, parsed.data.contactId);
  if (!contact) return err("not found or not yours");
  return ok(serializeContact(contact));
}

async function createContact(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = createContactSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const id = await createContactForUser(ctx.userId, parsed.data);
  const contact = await getContactForUser(ctx.userId, id);
  return ok(contact ? serializeContact(contact) : { id });
}

async function updateContact(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = updateContactSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const existing = await getContactForUser(ctx.userId, parsed.data.contactId);
  if (!existing) return err("not found or not yours");
  if (parsed.data.name !== undefined) {
    await renameContactForUser(
      ctx.userId,
      parsed.data.contactId,
      parsed.data.name,
    );
  }
  for (const email of parsed.data.emails ?? []) {
    await addContactEmailForUser(
      ctx.userId,
      parsed.data.contactId,
      email.email,
      email.label || "personal",
    );
  }
  const contact = await getContactForUser(ctx.userId, parsed.data.contactId);
  return ok(
    contact ? serializeContact(contact) : { id: parsed.data.contactId },
  );
}

async function deleteContact(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = deleteContactSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const contact = await getContactForUser(ctx.userId, parsed.data.contactId);
  if (!contact) return err("not found or not yours");
  const emails = contact.emails.map((e) => e.email).join(", ");
  return stubConfirmation(
    ctx,
    "delete_contact",
    args,
    `Delete contact ${contact.name}${emails ? ` (${emails})` : ""}`,
  );
}

async function listGroups(
  ctx: ToolContext,
  _args: Record<string, unknown>,
): Promise<ToolResult> {
  const groups = await listGroupsForUser(ctx.userId);
  return ok({ items: groups });
}

async function createGroup(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = createGroupSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const id = await createGroupForUser(ctx.userId, parsed.data);
  const groups = await listGroupsForUser(ctx.userId);
  return ok(groups.find((g) => g.id === id) ?? { id });
}

async function updateGroup(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = updateGroupSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  if (
    parsed.data.name === undefined &&
    parsed.data.defaultTarget === undefined
  ) {
    return err("Provide name or defaultTarget");
  }
  if (parsed.data.name !== undefined) {
    await renameGroupForUser(ctx.userId, parsed.data.groupId, parsed.data.name);
  }
  if (parsed.data.defaultTarget !== undefined) {
    await setGroupDefaultTargetForUser(
      ctx.userId,
      parsed.data.groupId,
      parsed.data.defaultTarget,
    );
  }
  const groups = await listGroupsForUser(ctx.userId);
  const group = groups.find((g) => g.id === parsed.data.groupId);
  if (!group) return err("not found or not yours");
  return ok(group);
}

async function deleteGroup(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = deleteGroupSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  const groups = await listGroupsForUser(ctx.userId);
  const group = groups.find((g) => g.id === parsed.data.groupId);
  if (!group) return err("not found or not yours");
  return stubConfirmation(
    ctx,
    "delete_contact_group",
    args,
    `Delete contact group ${group.name}`,
  );
}

async function addMember(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = addMemberSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  await addGroupMemberForUser(
    ctx.userId,
    parsed.data.groupId,
    parsed.data.contactEmailId,
  );
  return ok({ ok: true });
}

async function removeMember(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = removeMemberSchema.safeParse(args);
  if (!parsed.success) return err(firstZodMessage(parsed.error));
  await removeGroupMemberForUser(ctx.userId, parsed.data.memberId);
  return ok({ ok: true });
}

function serializeContact(contact: {
  id: string;
  name: string;
  emails: Array<{
    id: string;
    email: string;
    label: string;
    isPrimary: boolean;
  }>;
}) {
  return {
    id: contact.id,
    name: contact.name,
    emails: contact.emails.map((e) => ({
      id: e.id,
      email: e.email,
      label: e.label,
      isPrimary: e.isPrimary,
    })),
  };
}
