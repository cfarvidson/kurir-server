import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import SetupForm from "@/components/auth/setup-form";
import SetupWizard from "@/components/auth/setup-wizard";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const [session, userCount] = await Promise.all([
    auth(),
    db.user.count({ take: 1 }),
  ]);

  const { oauth } = getConfig();
  const oauthEnabled = {
    microsoft: !!(oauth.microsoft.clientId && oauth.microsoft.clientSecret),
    google: !!(oauth.google.clientId && oauth.google.clientSecret),
  };

  // First-run: no users exist → show the setup wizard
  if (userCount === 0) {
    return <SetupWizard oauthEnabled={oauthEnabled} />;
  }

  // Users exist but not logged in → 404 (setup route only for first-run or add-mode)
  if (!session?.user) {
    notFound();
  }

  // Logged in → show the existing add-connection form
  return <SetupForm oauthEnabled={oauthEnabled} />;
}
