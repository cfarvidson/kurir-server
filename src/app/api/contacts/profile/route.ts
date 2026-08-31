import { NextRequest, NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/mobile/auth";
import { getPersonProfile, isValidTimeZone } from "@/lib/mail/person-profile";

/**
 * GET /api/contacts/profile?email=<address>[&tz=<IANA zone>]
 *
 * One person profile for web and mobile (session cookie or bearer token):
 * contact details with source (Contact record over signature), counts,
 * first/last contact, median response times, arrival-hour histogram, and
 * Rank. `tz` overrides the account timezone for the histogram (the mobile
 * client sends the device zone). See docs/person-rank.md.
 */
export async function GET(request: NextRequest) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = request.nextUrl.searchParams.get("email")?.trim() ?? "";
  if (!email.includes("@")) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const tz = request.nextUrl.searchParams.get("tz");
  if (tz && !isValidTimeZone(tz)) {
    return NextResponse.json({ error: "Invalid tz" }, { status: 400 });
  }

  const profile = await getPersonProfile(userId, email, { timeZone: tz });
  return NextResponse.json(profile);
}
