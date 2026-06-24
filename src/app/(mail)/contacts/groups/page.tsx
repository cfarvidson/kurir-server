import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listGroups } from "@/actions/contact-groups";
import { db } from "@/lib/db";
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
      <div className="flex h-16 items-center justify-between border-b px-4 md:px-6">
        <div className="flex items-center gap-2">
          <Link
            href="/contacts"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Back to contacts"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-xl font-semibold tracking-tight md:text-title">Groups</h1>
        </div>
        <div className="text-sm text-muted-foreground">
          {groups.length} {groups.length === 1 ? "group" : "groups"}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <GroupList groups={groups} contactEmailOptions={contactEmailOptions} />
      </div>
    </div>
  );
}
