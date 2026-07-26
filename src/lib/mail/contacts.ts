import { z } from "zod";
import { db } from "@/lib/db";

/**
 * Contact cores, shared by the web server actions (`@/actions/contacts`) and
 * the mobile routes (`/api/mobile/contacts`). Auth is resolved by the
 * callers; these functions take a `userId` and own everything else — the
 * ownership checks, duplicate-email guards, sender auto-linking and primary
 * promotion — so both surfaces behave identically and can never drift.
 *
 * Like the cores in `scheduled-messages.ts`, these do NOT touch the cache
 * layer — the web wrappers own revalidatePath/updateTag.
 *
 * Out of scope here (web-only for now): linkContacts, unlinkContactEmail and
 * findOrCreateContactForEmail (shared with the sync path) stay in
 * `@/actions/contacts`.
 */

/** Label vocabulary offered by the clients. The DB column is a free-form
 * string and the web action accepts anything (defaulting to "personal"), so
 * the enum is enforced at the mobile edge only. */
export const contactEmailLabelSchema = z.enum(["personal", "work", "other"]);

export const createContactSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  emails: z
    .array(
      z.object({
        email: z.string().trim().min(1, "Email is required"),
        label: contactEmailLabelSchema.optional(),
      }),
    )
    .min(1, "At least one email is required"),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

/** Emails ordered as the web /contacts page renders them. */
const emailsOrderBy = [
  { isPrimary: "desc" as const },
  { email: "asc" as const },
];

const contactInclude = {
  emails: { orderBy: emailsOrderBy },
};

export function listContactsForUser(userId: string) {
  return db.contact.findMany({
    where: { userId },
    include: contactInclude,
    orderBy: { name: "asc" },
  });
}

export function getContactForUser(userId: string, contactId: string) {
  return db.contact.findFirst({
    where: { id: contactId, userId },
    include: contactInclude,
  });
}

export async function createContactForUser(
  userId: string,
  data: { name: string; emails: { email: string; label?: string }[] },
): Promise<string> {
  const name = data.name.trim();
  if (!name) {
    throw new Error("Name is required");
  }

  if (data.emails.length === 0) {
    throw new Error("At least one email is required");
  }

  // Check for duplicate emails across user's contacts
  const emailAddresses = data.emails.map((e) => e.email.toLowerCase().trim());
  const existing = await db.contactEmail.findFirst({
    where: {
      email: { in: emailAddresses },
      contact: { userId },
    },
    select: { email: true },
  });

  if (existing) {
    throw new Error(`Email ${existing.email} is already linked to a contact`);
  }

  // Look up matching approved senders for auto-linking
  const senders = await db.sender.findMany({
    where: {
      userId,
      email: { in: emailAddresses },
      status: "APPROVED",
    },
    select: { id: true, email: true },
  });

  const senderByEmail = new Map(senders.map((s) => [s.email, s.id]));

  const contact = await db.$transaction(async (tx) => {
    const created = await tx.contact.create({
      data: {
        name,
        userId,
      },
    });

    await tx.contactEmail.createMany({
      data: emailAddresses.map((email, i) => ({
        email,
        label: data.emails[i].label || "personal",
        isPrimary: i === 0,
        contactId: created.id,
        senderId: senderByEmail.get(email) ?? null,
      })),
    });

    return created;
  });

  return contact.id;
}

export async function renameContactForUser(
  userId: string,
  contactId: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Name is required");
  }

  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: { userId: true },
  });

  if (!contact || contact.userId !== userId) {
    throw new Error("Contact not found");
  }

  await db.contact.update({
    where: { id: contactId },
    data: { name: trimmed },
  });
}

export async function deleteContactForUser(
  userId: string,
  contactId: string,
): Promise<void> {
  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: { userId: true },
  });

  if (!contact || contact.userId !== userId) {
    throw new Error("Contact not found");
  }

  // ContactEmails cascade-delete via onDelete: Cascade
  await db.contact.delete({
    where: { id: contactId },
  });
}

export async function addContactEmailForUser(
  userId: string,
  contactId: string,
  email: string,
  label: string,
): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  if (!normalizedEmail) {
    throw new Error("Email is required");
  }

  // Verify ownership
  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: { userId: true },
  });

  if (!contact || contact.userId !== userId) {
    throw new Error("Contact not found");
  }

  // Check for duplicate across ALL of user's contacts
  const existing = await db.contactEmail.findFirst({
    where: {
      email: normalizedEmail,
      contact: { userId },
    },
    select: { id: true },
  });

  if (existing) {
    throw new Error("This email is already linked to a contact");
  }

  // Check if contact has any existing emails (to decide isPrimary)
  const emailCount = await db.contactEmail.count({
    where: { contactId },
  });

  // Auto-link to approved sender if one exists
  const sender = await db.sender.findFirst({
    where: {
      userId,
      email: normalizedEmail,
      status: "APPROVED",
    },
    select: { id: true },
  });

  await db.contactEmail.create({
    data: {
      email: normalizedEmail,
      label: label || "personal",
      isPrimary: emailCount === 0,
      contactId,
      senderId: sender?.id ?? null,
    },
  });
}

export async function removeContactEmailForUser(
  userId: string,
  contactEmailId: string,
): Promise<void> {
  // Verify ownership through contact.userId
  const contactEmail = await db.contactEmail.findUnique({
    where: { id: contactEmailId },
    include: { contact: { select: { userId: true, id: true } } },
  });

  if (!contactEmail || contactEmail.contact.userId !== userId) {
    throw new Error("Contact email not found");
  }

  const wasPrimary = contactEmail.isPrimary;
  const contactId = contactEmail.contactId;

  await db.contactEmail.delete({
    where: { id: contactEmailId },
  });

  // If the removed email was primary, promote the first remaining email
  if (wasPrimary) {
    const firstRemaining = await db.contactEmail.findFirst({
      where: { contactId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (firstRemaining) {
      await db.contactEmail.update({
        where: { id: firstRemaining.id },
        data: { isPrimary: true },
      });
    }
  }
}

export async function setContactEmailLabelForUser(
  userId: string,
  contactEmailId: string,
  label: string,
): Promise<void> {
  const contactEmail = await db.contactEmail.findUnique({
    where: { id: contactEmailId },
    include: { contact: { select: { userId: true } } },
  });

  if (!contactEmail || contactEmail.contact.userId !== userId) {
    throw new Error("Contact email not found");
  }

  await db.contactEmail.update({
    where: { id: contactEmailId },
    data: { label },
  });
}

export async function setContactEmailPrimaryForUser(
  userId: string,
  contactEmailId: string,
): Promise<void> {
  const contactEmail = await db.contactEmail.findUnique({
    where: { id: contactEmailId },
    include: { contact: { select: { userId: true, id: true } } },
  });

  if (!contactEmail || contactEmail.contact.userId !== userId) {
    throw new Error("Contact email not found");
  }

  const contactId = contactEmail.contactId;

  await db.$transaction([
    // Unset all primaries on this contact
    db.contactEmail.updateMany({
      where: { contactId, isPrimary: true },
      data: { isPrimary: false },
    }),
    // Set the chosen email as primary
    db.contactEmail.update({
      where: { id: contactEmailId },
      data: { isPrimary: true },
    }),
  ]);
}
