import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listGroups } from "@/actions/contact-groups";
import { db } from "@/lib/db";
import { PageMasthead } from "@/components/layout/page-masthead";
import { GroupList } from "@/components/contacts/group-list";

export default async function ContactGroupsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const [groups, contacts] = await Promise.all([
    listGroups(),
    db.contact.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        name: true,
        emails: {
          orderBy: [{ isPrimary: "desc" }, { email: "asc" }],
          select: { id: true, email: true, isPrimary: true },
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // Flat list of selectable contact emails for the member picker.
  const contactEmailOptions = contacts.flatMap((c) =>
    c.emails.map((e) => ({
      contactEmailId: e.id,
      email: e.email,
      name: c.name,
    })),
  );

  return (
    <div className="flex h-full flex-col">
      <PageMasthead
        eyebrow="People"
        title="Groups"
        meta={`${groups.length} ${groups.length === 1 ? "group" : "groups"}`}
        actions={
          <Link
            href="/contacts"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            aria-label="Back to contacts"
          >
            <ChevronLeft className="h-4 w-4" />
            Contacts
          </Link>
        }
      />

      <div className="flex-1 overflow-auto">
        <GroupList groups={groups} contactEmailOptions={contactEmailOptions} />
      </div>
    </div>
  );
}
