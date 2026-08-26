import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canViewEvents } from "@/lib/roles";
import { listEventsForUser } from "@/lib/events";
import { listVenues } from "@/lib/venues";
import { listCalendarNotes, type CalendarNote } from "@/lib/calendar-notes";
import { EventsBoard } from "@/components/events/events-board";

type EventsPageProps = {
  searchParams?: Promise<{ month?: string; past?: string }>;
};

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!canViewEvents(user.role)) {
    redirect("/unauthorized");
  }

  const { month, past } = (await searchParams) ?? {};
  // ?past=1 is the escape hatch behind the "Show past" control. Without it the
  // rolling window would make an older event genuinely unreachable rather than
  // merely tidied away.
  const includePast = past === "1";

  const [events, venues, notesResult] = await Promise.all([
    listEventsForUser(user, { includePast }),
    listVenues(),
    listCalendarNotes().catch(
      (): { notes: CalendarNote[]; truncated: boolean; failed: true } => ({
        notes: [],
        truncated: false,
        failed: true,
      })
    ),
  ]);
  return (
    <EventsBoard
      user={user}
      events={events}
      venues={venues}
      notes={notesResult.notes}
      notesFailed={"failed" in notesResult}
      initialMonth={month}
      includePast={includePast}
    />
  );
}
