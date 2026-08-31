import { NextRequest, NextResponse } from "next/server";
import { getContactContext } from "@/lib/mail/contact-context";
import { getRequestUserId } from "@/lib/mobile/auth";
import { isValidTimeZone } from "@/lib/mail/person-profile";

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
  const tz = request.nextUrl.searchParams.get("tz");
  if (tz && !isValidTimeZone(tz)) {
    return NextResponse.json({ error: "Invalid tz" }, { status: 400 });
  }

  const context = await getContactContext(userId, email, { q, tz });
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
    // Signature details, stats and Rank (kurir-ios#116)
    profile: context.profile,
    // Network by strength (kurir-ios#117)
    network: context.network,
  });
}
