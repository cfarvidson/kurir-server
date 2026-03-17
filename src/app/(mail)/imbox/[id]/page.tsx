import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ThreadPageContent } from "@/components/mail/thread-page-content";
import { ArchiveButton } from "@/components/mail/archive-button";
import { SnoozeButton } from "@/components/mail/snooze-button";
import { ArchiveKeyboardShortcut } from "@/components/mail/archive-keyboard-shortcut";
import { getThreadMessages } from "@/lib/mail/threads";
import { pushFlagsToImap } from "@/lib/mail/flag-push";
import { SidebarRefresh } from "@/components/mail/sidebar-refresh";

async function getUserInfo(userId: string, connectionId: string) {
  const [conn, user] = await Promise.all([
    db.emailConnection.findFirst({
      where: { id: connectionId, userId },
      select: { email: true },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    }),
  ]);
  return { email: conn?.email || "", timezone: user?.timezone || "UTC" };
}

export default async function MessagePage({
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
  const returnPath = q ? `/imbox?q=${encodeURIComponent(q)}` : "/imbox";

  const threadResult = await getThreadMessages(session.user.id, id);

  if (!threadResult || threadResult.messages.length === 0) {
    notFound();
  }

  const { messages, markedRead } = threadResult;

  // Resolve currentUserEmail from the thread's connection, not the default connection.
  // This ensures "You" labels and reply address are correct for non-default accounts.
  const targetMessage = messages.find((m) => m.id === id) || messages[0];
  const userInfo = await getUserInfo(session.user.id, targetMessage.emailConnectionId);
  const currentUserEmail = userInfo.email;

  // Push \Seen to IMAP for messages just marked read (fire-and-forget)
  if (markedRead.length > 0) {
    pushFlagsToImap(session.user.id, markedRead, "\\Seen", "add").catch(console.error);
  }

  const subject = targetMessage.subject || "(no subject)";

  // For threading: always reference the actual last message
  const lastMessage = messages[messages.length - 1];

  // For reply address: find the last message from someone else (not yourself)
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
      {markedRead.length > 0 && <SidebarRefresh />}
      <ArchiveKeyboardShortcut messageId={id} returnPath={returnPath} />
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-card/80 backdrop-blur-sm px-4 py-3 md:px-6">
        <Link
          href={returnPath}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Imbox
          </span>
        </div>
        {messages.length > 1 && (
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium tabular-nums text-primary">
            {messages.length}
          </span>
        )}
        <SnoozeButton messageId={id} returnPath={returnPath} timezone={userInfo.timezone} />
        <ArchiveButton messageId={id} returnPath={returnPath} />
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-3 py-4 md:px-6 md:py-8">
          {/* Subject */}
          <h1 className="text-lg font-bold tracking-tight text-foreground md:text-2xl">{subject}</h1>

          {/* Messages + Reply */}
          <div className="mt-3 md:mt-6">
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
