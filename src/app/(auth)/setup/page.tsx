import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import SetupForm from "@/components/auth/setup-form";
import SetupWizard from "@/components/auth/setup-wizard";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const [session, userCount] = await Promise.all([
    auth(),
    db.user.count({ take: 1 }),
  ]);

  const oauthEnabled = {
    microsoft: !!process.env.MICROSOFT_CLIENT_ID,
    google: !!process.env.GOOGLE_CLIENT_ID,
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
