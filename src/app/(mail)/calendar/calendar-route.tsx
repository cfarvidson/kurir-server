import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { loadCalendarPage } from "@/lib/calendar/page-data";
import { CalendarShell } from "@/components/calendar/calendar-shell";
import type { CalendarViewMode } from "@/components/calendar/types";

export async function CalendarRoute({
  mode,
  searchParams,
}: {
  mode: CalendarViewMode;
  searchParams: Promise<{ date?: string; new?: string; stay?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const search = await searchParams;
  const payload = await loadCalendarPage(session.user.id, mode, {
    date: search.date,
    new: search.new,
  });

  return <CalendarShell payload={payload} />;
}
