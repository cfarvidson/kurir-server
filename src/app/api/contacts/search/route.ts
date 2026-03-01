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

  // Exclude the user's own email addresses from contact suggestions
  const userConnections = await db.emailConnection.findMany({
    where: { userId: session.user.id },
    select: { email: true },
  });
  const userEmails = userConnections.map((c) => c.email);

  const contacts = await db.sender.findMany({
    where: {
      userId: session.user.id,
      status: "APPROVED",
      NOT: { email: { in: userEmails } },
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      email: true,
      displayName: true,
    },
    orderBy: [{ displayName: "asc" }, { email: "asc" }],
    take: 8,
  });

  return NextResponse.json(contacts);
}
