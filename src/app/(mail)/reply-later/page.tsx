import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageMasthead } from "@/components/layout/page-masthead";
import { getMessages } from "@/lib/mail/messages";
import { collapseToThreads } from "@/lib/mail/threads";
import {
  ReplyLaterFocus,
  type ReplyLaterItem,
} from "@/components/mail/reply-later-focus";

export default async function ReplyLaterPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const result = await getMessages(session.user.id, "reply-later", 100);
  const threads = result ? collapseToThreads(result.messages) : [];

  const items: ReplyLaterItem[] = threads.map((m) => ({
    id: m.id,
    subject: m.subject,
    snippet: m.snippet,
    fromName: m.sender?.displayName ?? m.fromName,
    fromAddress: m.fromAddress,
    receivedAt: m.receivedAt,
    threadCount: m.threadCount,
  }));

  return (
    <div className="flex h-full flex-col">
      <PageMasthead eyebrow="Later" title="Reply Later" />

      {/* Focus stack */}
      <div className="flex-1 overflow-auto">
        <ReplyLaterFocus items={items} />
      </div>
    </div>
  );
}
