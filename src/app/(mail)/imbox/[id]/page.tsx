import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { formatDate } from "@/lib/date";
import Link from "next/link";
import { ArrowLeft, Paperclip } from "lucide-react";

async function getMessage(userId: string, messageId: string) {
  const message = await db.message.findFirst({
    where: { id: messageId, userId },
    include: {
      sender: { select: { displayName: true, email: true } },
      attachments: true,
    },
  });

  if (message && !message.isRead) {
    await db.message.update({
      where: { id: message.id },
      data: { isRead: true },
    });
  }

  return message;
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
  const message = await getMessage(session.user.id, id);

  if (!message) {
    notFound();
  }

  const senderName =
    message.sender?.displayName || message.fromName || message.fromAddress;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center gap-4 border-b px-6">
        <Link
          href="/imbox"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </div>

      {/* Message */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {/* Subject */}
          <h1 className="text-2xl font-semibold">
            {message.subject || "(no subject)"}
          </h1>

          {/* Metadata */}
          <div className="mt-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                {senderName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-medium">{senderName}</div>
                <div className="text-sm text-muted-foreground">
                  {message.fromAddress}
                </div>
                {message.toAddresses.length > 0 && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    To: {message.toAddresses.join(", ")}
                  </div>
                )}
                {message.ccAddresses.length > 0 && (
                  <div className="text-sm text-muted-foreground">
                    Cc: {message.ccAddresses.join(", ")}
                  </div>
                )}
              </div>
            </div>
            <div className="shrink-0 text-sm text-muted-foreground">
              {formatDate(new Date(message.receivedAt))}
            </div>
          </div>

          {/* Attachments */}
          {message.attachments.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {message.attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-3 py-1.5 text-sm"
                >
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                  {att.filename}
                  <span className="text-muted-foreground">
                    ({Math.round(att.size / 1024)}KB)
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Body */}
          <div className="mt-6 border-t pt-6">
            {message.htmlBody ? (
              <div
                className="prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: message.htmlBody }}
              />
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-sm">
                {message.textBody || "No content"}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
