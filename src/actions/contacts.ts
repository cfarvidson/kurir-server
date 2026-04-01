"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// 1. createContact
// ---------------------------------------------------------------------------

export async function createContact(data: {
  name: string;
  emails: { email: string; label: string }[];
}) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const name = data.name.trim();
  if (!name) {
    throw new Error("Name is required");
  }

  if (data.emails.length === 0) {
    throw new Error("At least one email is required");
  }

  const userId = session.user.id;

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

  revalidatePath("/contacts");

  return contact.id;
}

// ---------------------------------------------------------------------------
// 2. updateContactName
// ---------------------------------------------------------------------------

export async function updateContactName(contactId: string, name: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Name is required");
  }

  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: { userId: true },
  });

  if (!contact || contact.userId !== session.user.id) {
    throw new Error("Contact not found");
  }

  await db.contact.update({
    where: { id: contactId },
    data: { name: trimmed },
  });

  revalidatePath("/contacts");
  revalidatePath("/contacts/[id]", "page");
}

// ---------------------------------------------------------------------------
// 3. deleteContact
// ---------------------------------------------------------------------------

export async function deleteContact(contactId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: { userId: true },
  });

  if (!contact || contact.userId !== session.user.id) {
    throw new Error("Contact not found");
  }

  // ContactEmails cascade-delete via onDelete: Cascade
  await db.contact.delete({
    where: { id: contactId },
  });

  revalidatePath("/contacts");
  revalidatePath("/contacts/[id]", "page");
}

// ---------------------------------------------------------------------------
// 4. addContactEmail
// ---------------------------------------------------------------------------

export async function addContactEmail(
  contactId: string,
  email: string,
  label: string,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;
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

  revalidatePath("/contacts");
  revalidatePath("/contacts/[id]", "page");
}

// ---------------------------------------------------------------------------
// 5. removeContactEmail
// ---------------------------------------------------------------------------

export async function removeContactEmail(contactEmailId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  // Verify ownership through contact.userId
  const contactEmail = await db.contactEmail.findUnique({
    where: { id: contactEmailId },
    include: { contact: { select: { userId: true, id: true } } },
  });

  if (!contactEmail || contactEmail.contact.userId !== session.user.id) {
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

  revalidatePath("/contacts");
  revalidatePath("/contacts/[id]", "page");
}

// ---------------------------------------------------------------------------
// 6. updateContactEmailLabel
// ---------------------------------------------------------------------------

export async function updateContactEmailLabel(
  contactEmailId: string,
  label: string,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const contactEmail = await db.contactEmail.findUnique({
    where: { id: contactEmailId },
    include: { contact: { select: { userId: true } } },
  });

  if (!contactEmail || contactEmail.contact.userId !== session.user.id) {
    throw new Error("Contact email not found");
  }

  await db.contactEmail.update({
    where: { id: contactEmailId },
    data: { label },
  });

  revalidatePath("/contacts");
  revalidatePath("/contacts/[id]", "page");
}

// ---------------------------------------------------------------------------
// 7. setContactEmailPrimary
// ---------------------------------------------------------------------------

export async function setContactEmailPrimary(contactEmailId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const contactEmail = await db.contactEmail.findUnique({
    where: { id: contactEmailId },
    include: { contact: { select: { userId: true, id: true } } },
  });

  if (!contactEmail || contactEmail.contact.userId !== session.user.id) {
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

  revalidatePath("/contacts");
  revalidatePath("/contacts/[id]", "page");
}

// ---------------------------------------------------------------------------
// 8. linkContacts (merge source into target)
// ---------------------------------------------------------------------------

export async function linkContacts(
  targetContactId: string,
  sourceContactId: string,
) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;

  // Verify ownership of both contacts
  const [target, source] = await Promise.all([
    db.contact.findUnique({
      where: { id: targetContactId },
      select: { userId: true },
    }),
    db.contact.findUnique({
      where: { id: sourceContactId },
      select: { userId: true },
    }),
  ]);

  if (!target || target.userId !== userId) {
    throw new Error("Target contact not found");
  }

  if (!source || source.userId !== userId) {
    throw new Error("Source contact not found");
  }

  if (targetContactId === sourceContactId) {
    throw new Error("Cannot merge a contact with itself");
  }

  const updatedTarget = await db.$transaction(async (tx) => {
    // Move all emails from source to target
    await tx.contactEmail.updateMany({
      where: { contactId: sourceContactId },
      data: { contactId: targetContactId },
    });

    // Delete the source contact (now email-less)
    await tx.contact.delete({
      where: { id: sourceContactId },
    });

    // Return the updated target with its emails
    return tx.contact.findUnique({
      where: { id: targetContactId },
      include: {
        emails: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  });

  revalidatePath("/contacts");
  revalidatePath("/contacts/[id]", "page");

  return updatedTarget;
}

// ---------------------------------------------------------------------------
// 9. unlinkContactEmail (split into new contact)
// ---------------------------------------------------------------------------

export async function unlinkContactEmail(contactEmailId: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;

  const contactEmail = await db.contactEmail.findUnique({
    where: { id: contactEmailId },
    include: {
      contact: { select: { userId: true, id: true } },
      sender: { select: { displayName: true } },
    },
  });

  if (!contactEmail || contactEmail.contact.userId !== userId) {
    throw new Error("Contact email not found");
  }

  const sourceContactId = contactEmail.contactId;

  // Must have 2+ emails to split
  const emailCount = await db.contactEmail.count({
    where: { contactId: sourceContactId },
  });

  if (emailCount < 2) {
    throw new Error("Cannot split: contact must have at least 2 emails");
  }

  // Derive a name for the new contact
  const newName =
    contactEmail.sender?.displayName ||
    contactEmail.email.split("@")[0] ||
    contactEmail.email;

  const newContact = await db.$transaction(async (tx) => {
    // Create new contact
    const created = await tx.contact.create({
      data: {
        name: newName,
        userId,
      },
    });

    // Move the email to the new contact and make it primary
    await tx.contactEmail.update({
      where: { id: contactEmailId },
      data: {
        contactId: created.id,
        isPrimary: true,
      },
    });

    // If the moved email was primary on the source, promote another
    if (contactEmail.isPrimary) {
      const firstRemaining = await tx.contactEmail.findFirst({
        where: { contactId: sourceContactId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      if (firstRemaining) {
        await tx.contactEmail.update({
          where: { id: firstRemaining.id },
          data: { isPrimary: true },
        });
      }
    }

    return created;
  });

  revalidatePath("/contacts");
  revalidatePath("/contacts/[id]", "page");

  return newContact.id;
}

// ---------------------------------------------------------------------------
// 10. findOrCreateContactForEmail (plain helper, no auth check)
// ---------------------------------------------------------------------------

export async function findOrCreateContactForEmail(
  userId: string,
  email: string,
  displayName?: string | null,
) {
  const normalizedEmail = email.toLowerCase().trim();

  // Check if a ContactEmail already exists for this user
  const existing = await db.contactEmail.findFirst({
    where: {
      email: normalizedEmail,
      contact: { userId },
    },
    include: {
      contact: {
        include: {
          emails: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  if (existing) {
    return existing.contact;
  }

  // Auto-link to approved sender if one exists
  const sender = await db.sender.findFirst({
    where: {
      userId,
      email: normalizedEmail,
      status: "APPROVED",
    },
    select: { id: true, displayName: true },
  });

  // Derive contact name: prefer passed displayName, then sender displayName, then email local part
  const name =
    displayName?.trim() ||
    sender?.displayName?.trim() ||
    normalizedEmail.split("@")[0] ||
    normalizedEmail;

  const contact = await db.$transaction(async (tx) => {
    const created = await tx.contact.create({
      data: {
        name,
        userId,
      },
    });

    await tx.contactEmail.create({
      data: {
        email: normalizedEmail,
        label: "personal",
        isPrimary: true,
        contactId: created.id,
        senderId: sender?.id ?? null,
      },
    });

    return tx.contact.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        emails: { orderBy: { createdAt: "asc" } },
      },
    });
  });

  return contact;
}
