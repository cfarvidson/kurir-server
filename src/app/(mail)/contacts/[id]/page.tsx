import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getThreadCounts, collapseToThreads } from "@/lib/mail/threads";
import { ContactDetail } from "@/components/contacts/contact-detail";

async function getContact(userId: string, contactId: string) {
  return db.contact.findFirst({
    where: { id: contactId, userId },
    include: {
      emails: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        include: {
          sender: {
            select: { category: true, messageCount: true, email: true },
          },
        },
      },
    },
  });
}

async function getConversations(userId: string, emailAddresses: string[]) {
  if (emailAddresses.length === 0) return [];

  const messages = await db.message.findMany({
    where: {
      userId,
      OR: [
        { fromAddress: { in: emailAddresses } },
        { toAddresses: { hasSome: emailAddresses } },
      ],
    },
    include: {
      sender: { select: { displayName: true, email: true } },
      attachments: { select: { id: true } },
    },
    orderBy: { receivedAt: "desc" },
  });

  const collapsed = collapseToThreads(messages);
  const threadCounts = await getThreadCounts(userId, collapsed);

  return collapsed.map((msg) => ({
    ...msg,
    threadCount: threadCounts.get(msg.id) ?? 1,
    hasAttachments: msg.attachments.length > 0,
  }));
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;
  const userId = session.user.id;
  const contact = await getContact(userId, id);

  if (!contact) {
    notFound();
  }

  const emailAddresses = contact.emails.map((e) => e.email);
  const conversations = await getConversations(userId, emailAddresses);

  // Serialize for the client component
  const contactData = {
    id: contact.id,
    name: contact.name,
    emails: contact.emails.map((e) => ({
      id: e.id,
      email: e.email,
      label: e.label,
      isPrimary: e.isPrimary,
      sender: e.sender
        ? { category: e.sender.category, messageCount: e.sender.messageCount }
        : null,
    })),
  };

  return <ContactDetail contact={contactData} conversations={conversations} />;
}
