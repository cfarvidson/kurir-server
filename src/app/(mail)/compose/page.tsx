import { auth, getUserEmailConnections } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ComposeClientPage } from "./compose-client";

export default async function ComposePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const [connections, user] = await Promise.all([
    getUserEmailConnections(session.user.id),
    db.user.findUnique({
      where: { id: session.user.id },
      select: { timezone: true },
    }),
  ]);

  const fromConnections = connections.map((c) => ({
    id: c.id,
    email: c.email,
    displayName: c.displayName,
    isDefault: c.isDefault,
  }));

  return (
    <ComposeClientPage
      connections={fromConnections}
      userTimezone={user?.timezone ?? "UTC"}
    />
  );
}
