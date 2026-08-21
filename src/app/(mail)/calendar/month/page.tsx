import { CalendarRoute } from "../calendar-route";

export default function CalendarMonthPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; new?: string; stay?: string }>;
}) {
  return <CalendarRoute mode="month" searchParams={searchParams} />;
}
