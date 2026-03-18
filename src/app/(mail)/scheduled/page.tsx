import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import {
  ScheduledMessageList,
  type ScheduledMessageItem,
} from "@/components/mail/scheduled-message-list";

async function getScheduledMessages(
  userId: string,
): Promise<ScheduledMessageItem[]> {
  const messages = await db.scheduledMessage.findMany({
    where: {
      userId,
      status: { in: ["PENDING", "FAILED"] },
    },
    orderBy: { scheduledFor: "asc" },
  });

  return messages.map((msg) => {
    let snippet = "";
    try {
      const decrypted = decrypt(msg.textBody);
      snippet = decrypted.slice(0, 150).replace(/\s+/g, " ").trim();
      if (decrypted.length > 150) snippet += "...";
    } catch {
      // Decryption failed — show nothing rather than crash
    }

    return {
      id: msg.id,
      to: msg.to,
      subject: msg.subject,
      snippet,
      scheduledFor: msg.scheduledFor.toISOString(),
      status: msg.status as "PENDING" | "FAILED",
      error: msg.error,
    };
  });
}

async function getUserTimezone(userId: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  return user?.timezone || "UTC";
}

export default async function ScheduledPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const [messages, timezone] = await Promise.all([
    getScheduledMessages(session.user.id),
    getUserTimezone(session.user.id),
  ]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b pl-14 pr-4 md:px-6">
        <h1 className="text-xl font-semibold md:text-2xl">Scheduled</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <ScheduledMessageList messages={messages} timezone={timezone} />
      </div>
    </div>
  );
}
