import { NextRequest, NextResponse } from "next/server";
import { auth, getUserEmailConnections } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { z } from "zod";

const createConnectionSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  imapHost: z.string().min(1),
  imapPort: z.coerce.number().int().min(1).max(65535).default(993),
  smtpHost: z.string().min(1),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
  displayName: z.string().optional(),
  sendAsEmail: z.string().email().optional(),
  aliases: z.array(z.string().email()).optional().default([]),
  isDefault: z.boolean().optional().default(false),
});

// GET /api/connections — list all email connections for the current user
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connections = await getUserEmailConnections(session.user.id);

  // Strip encrypted password from response
  const safe = connections.map(({ encryptedPassword: _, ...conn }) => conn);

  return NextResponse.json({ connections: safe });
}

// POST /api/connections — add a new email connection
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createConnectionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { email, password, imapHost, imapPort, smtpHost, smtpPort, displayName, sendAsEmail, aliases, isDefault } =
    parsed.data;
  const userId = session.user.id;

  // Verify IMAP credentials before saving
  const { verifyImapCredentials } = await import("@/lib/mail/imap-verify");
  const isValid = await verifyImapCredentials(email, password, imapHost, imapPort);
  if (!isValid) {
    return NextResponse.json(
      { error: "Could not connect to IMAP server. Check your email and password." },
      { status: 422 }
    );
  }

  // Check for duplicate email on this user
  const existing = await db.emailConnection.findFirst({
    where: { userId, email },
  });
  if (existing) {
    return NextResponse.json(
      { error: "This email is already connected." },
      { status: 409 }
    );
  }

  // If this is the first connection, make it default regardless of flag
  const connectionCount = await db.emailConnection.count({ where: { userId } });
  const shouldBeDefault = isDefault || connectionCount === 0;

  // If making this connection default, clear existing default
  if (shouldBeDefault) {
    await db.emailConnection.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const connection = await db.emailConnection.create({
    data: {
      userId,
      email,
      encryptedPassword: encrypt(password),
      imapHost,
      imapPort,
      smtpHost,
      smtpPort,
      displayName: displayName ?? null,
      sendAsEmail: sendAsEmail ?? null,
      aliases,
      isDefault: shouldBeDefault,
    },
  });

  const { encryptedPassword: _, ...safe } = connection;

  return NextResponse.json({ connection: safe }, { status: 201 });
}
