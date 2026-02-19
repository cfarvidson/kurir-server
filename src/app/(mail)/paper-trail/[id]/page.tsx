import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ThreadPageContent } from "@/components/mail/thread-page-content";
import { ArchiveButton } from "@/components/mail/archive-button";
import { ArchiveKeyboardShortcut } from "@/components/mail/archive-keyboard-shortcut";
import { getThreadMessages } from "@/lib/mail/threads";
import { pushFlagsToImap } from "@/lib/mail/flag-push";

async function getUserEmail(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return user?.email || "";
}

export default async function PaperTrailMessagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;
  const { q } = await searchParams;
  const returnPath = q ? `/paper-trail?q=${encodeURIComponent(q)}` : "/paper-trail";
  const [threadResult, currentUserEmail] = await Promise.all([
    getThreadMessages(session.user.id, id),
    getUserEmail(session.user.id),
  ]);

  if (!threadResult || threadResult.messages.length === 0) {
    notFound();
  }

  const { messages, markedRead } = threadResult;

  // Push \Seen to IMAP for messages just marked read (fire-and-forget)
  if (markedRead.length > 0) {
    pushFlagsToImap(session.user.id, markedRead, "\\Seen", "add").catch(console.error);
  }

  const targetMessage = messages.find((m) => m.id === id) || messages[0];
  const subject = targetMessage.subject || "(no subject)";

  const lastMessage = messages[messages.length - 1];

  const lastIncoming = [...messages]
    .reverse()
    .find((m) => m.fromAddress !== currentUserEmail);
  const replyTarget = lastIncoming || lastMessage;
  const replyToAddress = replyTarget.replyTo || replyTarget.fromAddress;
  const replyToName =
    replyTarget.sender?.displayName ||
    replyTarget.fromName ||
    replyTarget.fromAddress;

  return (
    <div className="flex h-full flex-col">
      <ArchiveKeyboardShortcut messageId={id} returnPath={returnPath} />
      {/* Header */}
      <div className="flex h-16 items-center gap-4 border-b px-4 md:px-6">
        <Link
          href={returnPath}
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Paper Trail
        </Link>
        {messages.length > 1 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {messages.length} messages
          </span>
        )}
        <div className="ml-auto">
          <ArchiveButton messageId={id} returnPath={returnPath} />
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{subject}</h1>

          <div className="mt-6 md:mt-8">
            <ThreadPageContent
              initialMessages={messages}
              currentUserEmail={currentUserEmail}
              replyToMessageId={lastMessage.id}
              replyToAddress={replyToAddress}
              replyToName={replyToName}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
