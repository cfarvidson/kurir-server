import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageMasthead } from "@/components/layout/page-masthead";
import { ContentRulesView } from "@/components/filters/content-rules";
import { listContentRulesForUser } from "@/lib/mail/content-rule-store";
import { getDraftGenerationStatus } from "@/lib/draft-generation/credential";
import { parseSenderParam } from "@/lib/mail/content-rules";

export default async function FiltersPage({
  searchParams,
}: {
  searchParams: Promise<{ sender?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;
  // Linked from a thread header: prefill the sender and surface its rules.
  const focusSender = parseSenderParam((await searchParams).sender);

  const [rules, connections, draftGeneration] = await Promise.all([
    listContentRulesForUser(userId),
    db.emailConnection.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true },
    }),
    getDraftGenerationStatus(userId),
  ]);

  return (
    <div className="flex h-full flex-col">
      <PageMasthead
        eyebrow="Triage"
        title="AI Rules"
        meta={
          rules.length > 0
            ? `${rules.length} ${rules.length === 1 ? "rule" : "rules"}`
            : undefined
        }
      />
      <div className="flex-1 overflow-auto">
        <ContentRulesView
          rules={rules}
          connections={connections}
          modelConnected={draftGeneration.connected}
          focusSender={focusSender}
        />
      </div>
    </div>
  );
}
