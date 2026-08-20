import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import {
  buildCalendarAuthorizationUrl,
  getCalendarOAuthRedirectUri,
  isCalendarOAuthEnabled,
  parseCalendarOAuthProvider,
  safeCalendarOAuthRedirect,
  signCalendarOAuthState,
} from "@/lib/calendar/oauth";

/**
 * GET /api/calendar/oauth/start?provider=google|microsoft
 * Optional ?mobile=1 returns { url } JSON for native clients.
 */
export async function GET(request: NextRequest) {
  const provider = parseCalendarOAuthProvider(
    request.nextUrl.searchParams.get("provider"),
  );
  const mobile = request.nextUrl.searchParams.get("mobile") === "1";

  if (!provider) {
    if (mobile) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }
    return NextResponse.redirect(
      new URL("/settings?tab=calendar&error=Unknown+provider", request.url),
    );
  }

  if (!isCalendarOAuthEnabled(provider)) {
    return NextResponse.json(
      {
        error: `OAuth not configured for ${provider}. Set the required environment variables.`,
      },
      { status: 404 },
    );
  }

  const session = await auth();
  if (!session?.user?.id) {
    if (mobile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const redirect = safeCalendarOAuthRedirect(
    request.nextUrl.searchParams.get("redirect"),
  );
  const state = signCalendarOAuthState({
    userId: session.user.id,
    provider,
    redirect,
  });
  const authUrl = buildCalendarAuthorizationUrl(
    provider,
    getCalendarOAuthRedirectUri(),
    state,
  );

  const appConfig = getConfig();
  if (mobile) {
    const response = NextResponse.json({ url: authUrl });
    response.cookies.set("calendar_oauth_state", state, {
      httpOnly: true,
      secure: appConfig.isProduction,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    return response;
  }

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("calendar_oauth_state", state, {
    httpOnly: true,
    secure: appConfig.isProduction,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
