import { CalendarRoute } from "./calendar-route";

export default function CalendarWeekPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; new?: string; stay?: string }>;
}) {
  return <CalendarRoute mode="week" searchParams={searchParams} />;
}
