import { NextRequest, NextResponse } from "next/server";
import { getContactContext } from "@/lib/mail/contact-context";
import { getRequestUserId } from "@/lib/mobile/auth";

/**
 * Person pane data for an arbitrary address (kurir-ios#115). `q` filters
 * the conversations (subject / snippet) across every list.
 */
export async function GET(request: NextRequest) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  const q = request.nextUrl.searchParams.get("q");

  const context = await getContactContext(userId, email, { q });
  return NextResponse.json({
    email,
    sender: context.sender
      ? {
          id: context.sender.id,
          displayName: context.sender.displayName,
          status: context.sender.status,
          category: context.sender.category,
          messageCount: context.sender.messageCount,
        }
      : null,
    firstEmailAt: context.firstEmailAt,
    lastEmailAt: context.lastEmailAt,
    recentThreads: context.recentThreads,
  });
}
