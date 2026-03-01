import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ContactList } from "@/components/contacts/contact-list";
import { BookUser } from "lucide-react";

async function getContacts(userId: string, userEmail: string) {
  return db.sender.findMany({
    where: {
      userId,
      status: "APPROVED",
      NOT: { email: userEmail },
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      domain: true,
      category: true,
      messageCount: true,
      decidedAt: true,
    },
    orderBy: [{ displayName: "asc" }, { email: "asc" }],
  });
}

export default async function ContactsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const defaultConn = await db.emailConnection.findFirst({
    where: { userId: session.user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { email: true },
  });
  const contacts = await getContacts(session.user.id, defaultConn?.email || "");

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">Contacts</h1>
        <div className="text-sm text-muted-foreground">
          {contacts.length} people
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {contacts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="rounded-full bg-muted p-4">
              <BookUser className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mt-4 text-lg font-medium">No contacts yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Approve senders in the Screener and they&apos;ll appear here.
            </p>
          </div>
        ) : (
          <ContactList contacts={contacts} />
        )}
      </div>
    </div>
  );
}
