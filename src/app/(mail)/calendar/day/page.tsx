import { CalendarRoute } from "../calendar-route";

export default function CalendarDayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; new?: string; stay?: string }>;
}) {
  return <CalendarRoute mode="day" searchParams={searchParams} />;
}
