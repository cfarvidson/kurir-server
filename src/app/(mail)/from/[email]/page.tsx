import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { conversationsForEmails } from "@/lib/mail/person-history";
import { ContactThreadList } from "@/components/contacts/contact-thread-list";
import { PageMasthead } from "@/components/layout/page-masthead";
import { EmptyState } from "@/components/mail/empty-state";

export default async function PersonHistoryPage({
  params,
}: {
  params: Promise<{ email: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const { email: raw } = await params;
  const email = decodeURIComponent(raw).trim();
  if (!email.includes("@")) {
    notFound();
  }

  const userId = session.user.id;
  const [sender, linked] = await Promise.all([
    db.sender.findFirst({
      where: { userId, email: { equals: email, mode: "insensitive" } },
      select: { displayName: true, email: true },
    }),
    db.contactEmail.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        contact: { userId },
      },
      select: {
        contact: {
          select: {
            name: true,
            emails: { select: { email: true } },
          },
        },
      },
    }),
  ]);
  const displayName =
    linked?.contact.name ||
    sender?.displayName ||
    email.split("@")[0] ||
    email;
  const emails = [
    ...new Set([
      email,
      ...(linked?.contact.emails.map((item) => item.email) ?? []),
    ]),
  ];
  const conversations = await conversationsForEmails(userId, emails);

  return (
    <div className="flex h-full flex-col">
      <PageMasthead eyebrow="People" title={displayName} />
      <div className="flex-1 overflow-auto">
        {conversations.length === 0 ? (
          <EmptyState
            mascot="sender"
            eyebrow="People"
            title={displayName}
            description="No threads with this address."
          />
        ) : (
          <ContactThreadList
            conversations={conversations}
            contactName={displayName}
          />
        )}
      </div>
    </div>
  );
}
