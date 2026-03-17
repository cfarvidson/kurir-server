import { db } from "@/lib/db";
import RegisterForm from "@/components/auth/register-form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import Link from "next/link";
import { ShieldOff } from "lucide-react";

export default async function RegisterPage() {
  const settings = await db.systemSettings.findUnique({
    where: { id: "singleton" },
  });

  if (settings && !settings.signupsEnabled) {
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

  return <RegisterForm />;
}
