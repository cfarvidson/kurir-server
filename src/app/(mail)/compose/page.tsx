import { auth, getUserEmailConnections } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ComposeClientPage, type ForwardData } from "./compose-client";
import { formatDate } from "@/lib/date";

interface ComposePageProps {
  searchParams: Promise<{ forward?: string }>;
}

export default async function ComposePage({ searchParams }: ComposePageProps) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const params = await searchParams;

  const [connections, user] = await Promise.all([
    getUserEmailConnections(session.user.id),
    db.user.findUnique({
      where: { id: session.user.id },
      select: { timezone: true },
    }),
  ]);

  const fromConnections = connections.map((c) => ({
    id: c.id,
    email: c.email,
    displayName: c.displayName,
    isDefault: c.isDefault,
  }));

  // Handle forward pre-population
  let forwardData: ForwardData | undefined;
  if (params.forward) {
    const message = await db.message.findFirst({
      where: { id: params.forward, userId: session.user.id },
      select: {
        subject: true,
        fromAddress: true,
        fromName: true,
        sentAt: true,
        textBody: true,
        attachments: {
          select: {
            id: true,
            filename: true,
            contentType: true,
            size: true,
          },
        },
      },
    });

    if (message) {
      const dateStr = message.sentAt
        ? formatDate(message.sentAt)
        : "Unknown date";
      const fromStr = message.fromName
        ? `${message.fromName} <${message.fromAddress}>`
        : message.fromAddress;

      const forwardHeader = [
        "",
        "---------- Forwarded message ----------",
        `From: ${fromStr}`,
        `Date: ${dateStr}`,
        `Subject: ${message.subject || "(no subject)"}`,
        "",
        message.textBody || "",
      ].join("\n");

      forwardData = {
        subject: message.subject?.startsWith("Fwd:")
          ? message.subject
          : `Fwd: ${message.subject || ""}`,
        body: forwardHeader,
        attachments: message.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
          url: `/api/attachments/${a.id}`,
          status: "done" as const,
        })),
      };
    }
  }

  return (
    <ComposeClientPage
      connections={fromConnections}
      userTimezone={user?.timezone ?? "UTC"}
      forwardData={forwardData}
    />
  );
}
