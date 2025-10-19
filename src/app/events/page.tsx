import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listEventsForUser } from "@/lib/events";
import { listVenues } from "@/lib/venues";
import { EventsBoard } from "@/components/events/events-board";

export default async function EventsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [events, venues] = await Promise.all([listEventsForUser(user), listVenues()]);

  return <EventsBoard user={user} events={events} venues={venues} />;
}
