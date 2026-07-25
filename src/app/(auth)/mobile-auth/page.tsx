import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { MobileAuthApprove } from "@/components/auth/mobile-auth-approve";

export const dynamic = "force-dynamic";

const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * /mobile-auth — the approval page opened by the iOS app inside
 * ASWebAuthenticationSession. Because the page runs on the server's own
 * origin, the passkey works as a first-party WebAuthn credential without any
 * associated-domains entitlement. On Approve it mints a one-time code and
 * hands it back to the app via the kurir:// callback scheme.
 */
export default async function MobileAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ code_challenge?: string; device?: string }>;
}) {
  const { code_challenge: codeChallenge, device } = await searchParams;
  const session = await auth();

  // The proxy already bounces logged-out visitors to /login, but guard here
  // too so the page never renders an approval button without a session.
  if (!session?.user?.id) {
    const next = `/mobile-auth?code_challenge=${encodeURIComponent(
      codeChallenge ?? "",
    )}&device=${encodeURIComponent(device ?? "")}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const validChallenge =
    typeof codeChallenge === "string" && CHALLENGE_RE.test(codeChallenge);

  return (
    <MobileAuthApprove
      codeChallenge={validChallenge ? codeChallenge : null}
      deviceName={device ?? null}
    />
  );
}
