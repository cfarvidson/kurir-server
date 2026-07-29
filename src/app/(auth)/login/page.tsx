import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import LoginForm from "@/components/auth/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // If no users exist, redirect to first-run setup wizard
  const userCount = await db.user.count({ take: 1 });
  if (userCount === 0) {
    redirect("/setup");
  }

  // Demo instances (DEMO_LOGIN_* set) also offer password sign-in — the
  // passkey-only flow is unusable for App Store reviewers.
  const demoLoginEnabled = Boolean(
    process.env.DEMO_LOGIN_EMAIL && process.env.DEMO_LOGIN_PASSWORD,
  );

  return <LoginForm demoLoginEnabled={demoLoginEnabled} />;
}
