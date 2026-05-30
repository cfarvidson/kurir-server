import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Reply } from "lucide-react";
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
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b px-4 md:px-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold md:text-2xl">
          <Reply className="h-5 w-5 text-muted-foreground" />
          Reply Later
        </h1>
      </div>

      {/* Focus stack */}
      <div className="flex-1 overflow-auto">
        <ReplyLaterFocus items={items} />
      </div>
    </div>
  );
}
