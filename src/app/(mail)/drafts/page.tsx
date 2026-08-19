import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { draftCatalogHref } from "@/lib/mail/draft-presentation";
import { presentDraftsForUser } from "@/lib/mail/draft-presentation-db";
import { PageMasthead } from "@/components/layout/page-masthead";
import { DraftsList, type DraftListItem } from "@/components/mail/drafts-list";

async function getDrafts(userId: string): Promise<DraftListItem[]> {
  const drafts = await presentDraftsForUser(userId);
  return drafts.map((d) => ({
    type: d.type,
    contextMessageId: d.contextMessageId,
    to: d.to,
    subject: d.displaySubject,
    snippet: d.body.replace(/\s+/g, " ").trim().slice(0, 150),
    updatedAt: d.updatedAt.toISOString(),
    href: draftCatalogHref({
      type: d.type,
      contextMessageId: d.contextMessageId,
      folder: d.folder,
    }),
    displayFrom: d.displayFrom,
  }));
}

export default async function DraftsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const drafts = await getDrafts(session.user.id);

  return (
    <div className="flex h-full flex-col">
      <PageMasthead
        eyebrow="Outbound"
        title="Drafts"
        meta={
          drafts.length === 0
            ? undefined
            : drafts.length === 1
              ? "1 draft"
              : `${drafts.length} drafts`
        }
      />
      <div className="flex-1 overflow-auto">
        <DraftsList drafts={drafts} userId={session.user.id} />
      </div>
    </div>
  );
}
