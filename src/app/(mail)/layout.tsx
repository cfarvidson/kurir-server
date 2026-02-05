import { Sidebar } from "@/components/layout/sidebar";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

async function getScreenerCount(userId: string) {
  return db.sender.count({
    where: {
      userId,
      status: "PENDING",
    },
  });
}

export default async function MailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const screenerCount = await getScreenerCount(session.user.id);

  return (
    <div className="flex h-screen">
      <Sidebar screenerCount={screenerCount} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
