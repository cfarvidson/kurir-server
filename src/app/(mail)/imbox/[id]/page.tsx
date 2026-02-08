import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ThreadPageContent } from "@/components/mail/thread-page-content";
import { ArchiveButton } from "@/components/mail/archive-button";
import { getThreadMessages } from "@/lib/mail/threads";

async function getUserEmail(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return user?.email || "";
}

export default async function MessagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { id } = await params;
  const [messages, currentUserEmail] = await Promise.all([
    getThreadMessages(session.user.id, id),
    getUserEmail(session.user.id),
  ]);

  if (!messages || messages.length === 0) {
    notFound();
  }

  // The message that was clicked
  const targetMessage = messages.find((m) => m.id === id) || messages[0];
  const subject = targetMessage.subject || "(no subject)";

  // For reply: use the last message in the thread
  const lastMessage = messages[messages.length - 1];
  const replyToAddress = lastMessage.replyTo || lastMessage.fromAddress;
  const replyToName =
    lastMessage.sender?.displayName ||
    lastMessage.fromName ||
    lastMessage.fromAddress;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center gap-4 border-b px-4 md:px-6">
        <Link
          href="/imbox"
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        {messages.length > 1 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {messages.length} messages
          </span>
        )}
        <div className="ml-auto">
          <ArchiveButton messageId={id} />
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
          {/* Subject */}
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{subject}</h1>

          {/* Messages + Reply */}
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
