import { auth, getUserEmailConnections } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ComposeClientPage } from "./compose-client";

export default async function ComposePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const connections = await getUserEmailConnections(session.user.id);

  const fromConnections = connections.map((c) => ({
    id: c.id,
    email: c.email,
    displayName: c.displayName,
    isDefault: c.isDefault,
  }));

  return <ComposeClientPage connections={fromConnections} />;
}
