import { db } from "@/lib/db";
import RegisterForm from "@/components/auth/register-form";

export const dynamic = "force-dynamic";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import Link from "next/link";
import { ShieldOff } from "lucide-react";

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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 via-amber-50/50 to-stone-50/30 p-4">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader className="text-center pb-4">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <ShieldOff className="h-7 w-7 text-muted-foreground" />
              </div>
              <CardTitle className="text-2xl">Registration closed</CardTitle>
              <CardDescription>
                New signups are currently disabled by the administrator.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="text-primary hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <RegisterForm
      inviteToken={invite?.token}
      inviteDisplayName={invite?.displayName}
    />
  );
}
