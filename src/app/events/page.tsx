import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canViewEvents } from "@/lib/roles";
import { listEventsForUser } from "@/lib/events";
import { listVenues } from "@/lib/venues";
import { listCalendarNotes, type CalendarNote } from "@/lib/calendar-notes";
import { EventsBoard } from "@/components/events/events-board";

type EventsPageProps = {
  searchParams?: Promise<{ month?: string }>;
};

export default async function EventsPage({ searchParams }: EventsPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!canViewEvents(user.role)) {
    redirect("/unauthorized");
  }

  const [events, venues, notesResult] = await Promise.all([
    listEventsForUser(user),
    listVenues(),
    listCalendarNotes().catch(
      (): { notes: CalendarNote[]; truncated: boolean; failed: true } => ({
        notes: [],
        truncated: false,
        failed: true,
      })
    ),
  ]);
  const { month } = (await searchParams) ?? {};

  return (
    <EventsBoard
      user={user}
      events={events}
      venues={venues}
      notes={notesResult.notes}
      notesFailed={"failed" in notesResult}
      initialMonth={month}
    />
  );
}
