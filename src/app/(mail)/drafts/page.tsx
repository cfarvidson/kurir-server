import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { listDraftsForUser } from "@/lib/mail/drafts";
import { PageMasthead } from "@/components/layout/page-masthead";
import { DraftsList, type DraftListItem } from "@/components/mail/drafts-list";

async function getDrafts(userId: string): Promise<DraftListItem[]> {
  const drafts = await listDraftsForUser(userId);

  // Which reply/forward contexts still exist - rows whose original message is
  // gone open detached in the composer instead (never unreachable text).
  const contextIds = drafts
    .filter((d) => d.type !== "NEW")
    .map((d) => d.contextMessageId);
  const existing = contextIds.length
    ? await db.message.findMany({
        where: { id: { in: contextIds }, userId },
        select: { id: true },
      })
    : [];
  const existingIds = new Set(existing.map((m) => m.id));

  return drafts.map((d) => {
    let href: string;
    if (d.type === "NEW") {
      href = `/compose?draft=${encodeURIComponent(d.contextMessageId)}&from=/drafts`;
    } else if (!existingIds.has(d.contextMessageId)) {
      href = `/compose?draftType=${d.type}&draft=${encodeURIComponent(d.contextMessageId)}&from=/drafts`;
    } else if (d.type === "FORWARD") {
      href = `/compose?forward=${encodeURIComponent(d.contextMessageId)}&from=/drafts`;
    } else {
      href = `/imbox/${d.contextMessageId}`;
    }
    return {
      type: d.type,
      contextMessageId: d.contextMessageId,
      to: d.to,
      subject: d.subject,
      snippet: d.body.replace(/\s+/g, " ").trim().slice(0, 150),
      updatedAt: d.updatedAt.toISOString(),
      href,
    };
  });
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
