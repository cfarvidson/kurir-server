"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  addContactEmailForUser,
  createContactForUser,
  deleteContactForUser,
  removeContactEmailForUser,
  renameContactForUser,
  setContactEmailLabelForUser,
  setContactEmailPrimaryForUser,
} from "@/lib/mail/contacts";

// Sections 1-7 are thin wrappers over the shared cores in
// `@/lib/mail/contacts` (also used by /api/mobile/contacts): auth, then the
// core, then the cache revalidation the cores deliberately do not own.

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

  const contactId = await createContactForUser(session.user.id, data);

  revalidatePath("/contacts");

  return contactId;
}

// ---------------------------------------------------------------------------
// 2. updateContactName
// ---------------------------------------------------------------------------

export async function updateContactName(contactId: string, name: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  await renameContactForUser(session.user.id, contactId, name);

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

  await deleteContactForUser(session.user.id, contactId);

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

  await addContactEmailForUser(session.user.id, contactId, email, label);

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

  await removeContactEmailForUser(session.user.id, contactEmailId);

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

  await setContactEmailLabelForUser(session.user.id, contactEmailId, label);

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

  await setContactEmailPrimaryForUser(session.user.id, contactEmailId);

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
