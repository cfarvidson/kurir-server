import { auth, getUserEmailConnections } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  ComposeClientPage,
  type ForwardData,
  type EditScheduledData,
} from "./compose-client";
import { listGroups } from "@/actions/contact-groups";
import { formatDate } from "@/lib/date";
import { decrypt } from "@/lib/crypto";

interface ComposePageProps {
  searchParams: Promise<{ forward?: string; editScheduled?: string }>;
}

export default async function ComposePage({ searchParams }: ComposePageProps) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const params = await searchParams;

  const [connections, user, groups] = await Promise.all([
    getUserEmailConnections(session.user.id),
    db.user.findUnique({
      where: { id: session.user.id },
      select: { timezone: true },
    }),
    listGroups(),
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

  // Handle scheduled-message edit pre-population
  let editScheduled: EditScheduledData | undefined;
  if (params.editScheduled) {
    const scheduled = await db.scheduledMessage.findFirst({
      where: {
        id: params.editScheduled,
        userId: session.user.id,
        status: "PENDING",
      },
      select: {
        id: true,
        to: true,
        subject: true,
        textBody: true,
        scheduledFor: true,
        emailConnectionId: true,
        attachmentIds: true,
      },
    });

    if (scheduled) {
      let body = "";
      let bodyDecryptFailed = false;
      try {
        body = decrypt(scheduled.textBody);
      } catch {
        // Decryption failed — fall back to an empty body rather than crashing,
        // mirroring the snippet handling in scheduled/page.tsx. The client uses
        // bodyDecryptFailed to avoid overwriting the original ciphertext with an
        // empty body when the user re-schedules.
        bodyDecryptFailed = true;
      }

      const attachmentRecords = scheduled.attachmentIds.length
        ? await db.attachment.findMany({
            where: {
              id: { in: scheduled.attachmentIds },
              userId: session.user.id,
            },
            select: {
              id: true,
              filename: true,
              contentType: true,
              size: true,
            },
          })
        : [];

      editScheduled = {
        id: scheduled.id,
        to: scheduled.to,
        subject: scheduled.subject,
        body,
        bodyDecryptFailed,
        scheduledFor: scheduled.scheduledFor.toISOString(),
        emailConnectionId: scheduled.emailConnectionId,
        attachments: attachmentRecords.map((a) => ({
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
      userId={session.user.id}
      connections={fromConnections}
      userTimezone={user?.timezone ?? "UTC"}
      forwardData={forwardData}
      editScheduled={editScheduled}
      groups={groups}
    />
  );
}
