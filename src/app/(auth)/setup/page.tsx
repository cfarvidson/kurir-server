import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import SetupForm from "@/components/auth/setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const session = await auth();

  // If not logged in, only allow access when signups are enabled
  if (!session?.user) {
    const settings = await db.systemSettings.findUnique({
      where: { id: "singleton" },
    });

    if (settings && !settings.signupsEnabled) {
      redirect("/login");
    }
  }

  return <SetupForm />;
}
