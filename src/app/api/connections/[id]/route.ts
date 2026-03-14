import { NextRequest, NextResponse } from "next/server";
import { auth, getEmailConnection } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { z } from "zod";

const updateConnectionSchema = z.object({
  password: z.string().min(1).optional(),
  imapHost: z.string().min(1).optional(),
  imapPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpHost: z.string().min(1).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  displayName: z.string().optional(),
  sendAsEmail: z.string().email().nullable().optional(),
  isDefault: z.boolean().optional(),
});

// PATCH /api/connections/[id] — update an email connection
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const connection = await getEmailConnection(id, session.user.id);
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { password, imapHost, imapPort, smtpHost, smtpPort, displayName, sendAsEmail, isDefault } =
    parsed.data;

  // If password changed, re-verify IMAP before storing
  if (password) {
    const effectiveImapHost = imapHost ?? connection.imapHost;
    const effectiveImapPort = imapPort ?? connection.imapPort;
    const { verifyImapCredentials } = await import("@/lib/mail/imap-verify");
    const isValid = await verifyImapCredentials(
      connection.email,
      password,
      effectiveImapHost,
      effectiveImapPort
    );
    if (!isValid) {
      return NextResponse.json(
        { error: "Could not connect to IMAP server with the new password." },
        { status: 422 }
      );
    }
  }

  // If setting as default, clear existing default first
  if (isDefault) {
    await db.emailConnection.updateMany({
      where: { userId: session.user.id, isDefault: true, NOT: { id } },
      data: { isDefault: false },
    });
  }

  const updated = await db.emailConnection.update({
    where: { id },
    data: {
      ...(password && { encryptedPassword: encrypt(password) }),
      ...(imapHost !== undefined && { imapHost }),
      ...(imapPort !== undefined && { imapPort }),
      ...(smtpHost !== undefined && { smtpHost }),
      ...(smtpPort !== undefined && { smtpPort }),
      ...(displayName !== undefined && { displayName }),
      ...(sendAsEmail !== undefined && { sendAsEmail }),
      ...(isDefault !== undefined && { isDefault }),
    },
  });

  const { encryptedPassword: _, ...safe } = updated;
  return NextResponse.json({ connection: safe });
}

// DELETE /api/connections/[id] — remove an email connection
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const connection = await getEmailConnection(id, session.user.id);
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const userId = session.user.id;

  // Prevent deleting the last connection
  const count = await db.emailConnection.count({ where: { userId } });
  if (count <= 1) {
    return NextResponse.json(
      { error: "Cannot remove your only email connection." },
      { status: 409 }
    );
  }

  await db.emailConnection.delete({ where: { id } });

  // If this was the default, promote the oldest remaining connection
  if (connection.isDefault) {
    const next = await db.emailConnection.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    if (next) {
      await db.emailConnection.update({
        where: { id: next.id },
        data: { isDefault: true },
      });
    }
  }

  return NextResponse.json({ success: true });
}
