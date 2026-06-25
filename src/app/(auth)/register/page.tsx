import { db } from "@/lib/db";
import RegisterForm from "@/components/auth/register-form";

export const dynamic = "force-dynamic";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";

interface RegisterPageProps {
  searchParams: Promise<{ invite?: string }>;
}

export default async function RegisterPage({
  searchParams,
}: RegisterPageProps) {
  const { invite: inviteToken } = await searchParams;

  // Check for valid invite token
  let invite: { displayName: string; token: string } | null = null;
  if (inviteToken) {
    const found = await db.invite.findUnique({
      where: { token: inviteToken },
      select: { displayName: true, token: true, usedAt: true, expiresAt: true },
    });
    if (found && !found.usedAt && found.expiresAt > new Date()) {
      invite = { displayName: found.displayName, token: found.token };
    }
  }

  // Allow registration if: signups enabled OR valid invite
  const settings = await db.systemSettings.findUnique({
    where: { id: "singleton" },
  });
  const signupsEnabled = !settings || settings.signupsEnabled;

  if (!signupsEnabled && !invite) {
    return (
      <AuthShell>
        <div className="space-y-6">
          <div>
            <p className="eyebrow text-muted-foreground">Registration closed</p>
            <h2 className="mt-2 text-headline font-semibold tracking-tight text-foreground">
              By invitation only
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              New signups are currently disabled by the administrator.
            </p>
          </div>
          <p className="border-t border-border pt-4 text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <RegisterForm
      inviteToken={invite?.token}
      inviteDisplayName={invite?.displayName}
    />
  );
}
