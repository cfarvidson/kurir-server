import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createOauthCalendarAccount } from "@/lib/calendar/accounts";
import {
  exchangeCalendarCode,
  getCalendarOAuthRedirectUri,
  safeCalendarOAuthRedirect,
  verifyCalendarOAuthState,
} from "@/lib/calendar/oauth";

const SETTINGS = "/settings?tab=calendar";

function errorRedirect(request: NextRequest, message: string): NextResponse {
  return NextResponse.redirect(
    new URL(
      `${SETTINGS}&error=${encodeURIComponent(message)}`,
      request.url,
    ),
  );
}

/**
 * GET /api/calendar/oauth/callback?code=...&state=...
 * Exchanges the code, creates CalendarAccount, enqueues sync.
 */
export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    const desc =
      request.nextUrl.searchParams.get("error_description") || error;
    return errorRedirect(request, desc);
  }

  const code = request.nextUrl.searchParams.get("code");
  const stateParam = request.nextUrl.searchParams.get("state");
  if (!code || !stateParam) {
    return errorRedirect(request, "Missing authorization code");
  }

  let state;
  try {
    state = verifyCalendarOAuthState(stateParam);
  } catch {
    return errorRedirect(request, "Invalid state parameter");
  }

  const cookieState = request.cookies.get("calendar_oauth_state")?.value;
  if (cookieState && cookieState !== stateParam) {
    return errorRedirect(request, "Invalid state parameter");
  }

  const session = await auth();
  if (!session?.user?.id || session.user.id !== state.userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const tokens = await exchangeCalendarCode(
      state.provider,
      code,
      getCalendarOAuthRedirectUri(),
    );
    await createOauthCalendarAccount({
      userId: state.userId,
      provider: state.provider,
      email: tokens.email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

    const dest = safeCalendarOAuthRedirect(state.redirect);
    const response = NextResponse.redirect(new URL(dest, request.url));
    response.cookies.delete("calendar_oauth_state");
    return response;
  } catch (err) {
    console.error("[calendar oauth callback] Error:", err);
    const message =
      err instanceof Error ? err.message : "OAuth authentication failed";
    return errorRedirect(request, message);
  }
}
