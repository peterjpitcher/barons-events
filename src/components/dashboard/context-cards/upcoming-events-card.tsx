import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { UserRole } from "@/lib/types";

export type UpcomingEvent = {
  id: string;
  title: string;
  start_at: string;
  venue?: { name: string } | null;
  status: string;
};

type UpcomingEventsCardProps = {
  events: UpcomingEvent[] | null;
  userRole: UserRole;
  hasVenue: boolean;
};

export function UpcomingEventsCard({ events, userRole, hasVenue }: UpcomingEventsCardProps): React.ReactNode {
  if (!events) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-subtle">
          Couldn&apos;t load upcoming events. Try refreshing.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="text-sm">Upcoming Events</CardTitle>
        <Link href="/events" className="text-xs text-[var(--color-primary-600)] hover:text-[var(--color-primary-700)]">
          View all &rarr;
        </Link>
      </CardHeader>
      <CardContent className="space-y-2">
        {events.length === 0 ? (
          <div className="text-sm text-subtle">
            <p>No upcoming events.</p>
            {(userRole === "administrator" || (userRole === "office_worker" && hasVenue)) && (
              <Button asChild size="sm" className="mt-2">
                <Link href="/events/new">New Event</Link>
              </Button>
            )}
          </div>
        ) : (
          events.slice(0, 4).map((event) => (
            <Link
              key={event.id}
              href={`/events/${event.id}`}
              className="block rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[var(--color-surface-soft)]"
            >
              <p className="font-medium text-[var(--color-text)]">{event.title}</p>
              <p className="text-xs text-subtle">
                {new Date(event.start_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                {event.venue ? ` \u00b7 ${event.venue.name}` : ""}
              </p>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
