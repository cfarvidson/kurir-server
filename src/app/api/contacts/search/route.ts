import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() || "";

  if (q.length < 1) {
    return NextResponse.json([]);
  }

  const userId = session.user.id;

  // Exclude the user's own email addresses from contact suggestions
  const userConnections = await db.emailConnection.findMany({
    where: { userId },
    select: { email: true },
  });
  const userEmails = new Set(userConnections.map((c) => c.email.toLowerCase()));

  // 1. Search Contact records (prioritized)
  const contactResults = await db.contact.findMany({
    where: {
      userId,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { emails: { some: { email: { contains: q, mode: "insensitive" } } } },
      ],
    },
    select: {
      id: true,
      name: true,
      emails: {
        select: { email: true, label: true, isPrimary: true },
        orderBy: [{ isPrimary: "desc" }, { email: "asc" }],
      },
    },
    orderBy: { name: "asc" },
    take: 8,
  });

  // Filter out contacts where ALL emails are the user's own
  const contacts = contactResults
    .filter((c) => c.emails.some((e) => !userEmails.has(e.email.toLowerCase())))
    .map((c) => {
      // Remove user's own emails from the list
      const filteredEmails = c.emails.filter(
        (e) => !userEmails.has(e.email.toLowerCase()),
      );
      const primaryEmail =
        filteredEmails.find((e) => e.isPrimary)?.email ??
        filteredEmails[0]?.email ??
        "";
      return {
        id: c.id,
        name: c.name,
        email: primaryEmail,
        displayName: c.name,
        emails: filteredEmails,
      };
    });

  // Collect all emails already covered by contacts
  const contactEmails = new Set(
    contacts.flatMap((c) => c.emails.map((e) => e.email.toLowerCase())),
  );

  // 2. Search approved Senders NOT linked to any ContactEmail (unmigrated)
  const remaining = 8 - contacts.length;
  let senderResults: typeof contacts = [];

  if (remaining > 0) {
    const unmigrated = await db.sender.findMany({
      where: {
        userId,
        status: "APPROVED",
        NOT: { email: { in: [...userEmails] } },
        contactEmails: { none: {} },
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, email: true, displayName: true },
      orderBy: [{ displayName: "asc" }, { email: "asc" }],
      take: remaining,
    });

    // Deduplicate: skip senders whose email already appears in contact results
    senderResults = unmigrated
      .filter((s) => !contactEmails.has(s.email.toLowerCase()))
      .map((s) => ({
        id: `sender-${s.id}`,
        name: s.displayName || s.email,
        email: s.email,
        displayName: s.displayName ?? s.email,
        emails: [{ email: s.email, label: "personal", isPrimary: true }],
      }));
  }

  return NextResponse.json([...contacts, ...senderResults].slice(0, 8));
}
