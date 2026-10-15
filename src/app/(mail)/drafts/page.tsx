import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { draftCatalogHref } from "@/lib/mail/draft-presentation";
import { presentDraftsForUser } from "@/lib/mail/draft-presentation-db";
import { draftGroupNames, parseDraftGroups } from "@/lib/mail/draft-groups";
import { PageMasthead } from "@/components/layout/page-masthead";
import { DraftsList, type DraftListItem } from "@/components/mail/drafts-list";

async function getDrafts(userId: string): Promise<DraftListItem[]> {
  const [drafts, groups] = await Promise.all([
    presentDraftsForUser(userId),
    db.contactGroup.findMany({
      where: { userId },
      select: { id: true, name: true },
    }),
  ]);
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
    groupNames: draftGroupNames(parseDraftGroups(d.groups), groups),
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
