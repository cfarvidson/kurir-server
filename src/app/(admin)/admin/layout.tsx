import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { Providers } from "@/components/providers";
import { AdminNav } from "@/components/admin/admin-nav";
import { Toaster } from "sonner";
import {
  TOAST_SHELL_CLASS,
  TOAST_SHELL_STYLE,
} from "@/components/ui/toast-config";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let session;
  try {
    session = await requireAdmin();
  } catch {
    redirect("/imbox");
  }

  const userTheme = await db.user
    .findUnique({
      where: { id: session.user.id },
      select: { theme: true },
    })
    .then((u) => u?.theme ?? "system");

  return (
    <Providers defaultTheme={userTheme} userId={session.user.id}>
      <div className="flex h-screen h-dvh flex-col bg-background">
        <AdminNav />
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-5xl p-4 md:p-6">{children}</div>
        </main>
        <Toaster
          position="bottom-right"
          expand={false}
          visibleToasts={4}
          toastOptions={{
            className: TOAST_SHELL_CLASS,
            style: TOAST_SHELL_STYLE,
          }}
        />
      </div>
    </Providers>
  );
}
