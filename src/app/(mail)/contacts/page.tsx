import Link from "next/link";
import { Users } from "lucide-react";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageMasthead } from "@/components/layout/page-masthead";
import { ContactList } from "@/components/contacts/contact-list";

export default async function ContactsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const contacts = await db.contact.findMany({
    where: { userId: session.user.id },
    include: {
      emails: {
        orderBy: [{ isPrimary: "desc" }, { email: "asc" }],
        include: { sender: { select: { category: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex h-full flex-col">
      <PageMasthead
        eyebrow="People"
        title="Contacts"
        meta={`${contacts.length} ${contacts.length === 1 ? "person" : "people"}`}
        actions={
          <Link
            href="/contacts/groups"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <Users className="h-4 w-4" />
            Groups
          </Link>
        }
      />

      <div className="flex-1 overflow-auto">
        <ContactList contacts={contacts} />
      </div>
    </div>
  );
}
