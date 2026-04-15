import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { getStatusCounts, listEventsForUser, listReviewQueue, findConflicts } from "@/lib/events";

const roleCopy: Record<string, { heading: string; body: string }> = {
  administrator: {
    heading: "Today’s planning view",
    body: "Check in on pending submissions, watch for clashes, and keep the pipeline moving."
  },
  office_worker: {
    heading: "Your upcoming plans",
    body: "Draft fresh ideas, tidy earlier submissions, and stay on top of feedback."
  },
  executive: {
    heading: "Snapshot",
    body: "Track event totals and key updates at a glance."
  }
};

export default async function OverviewPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const copy = roleCopy[user.role] ?? roleCopy["administrator"];

  const cards: ReactNode[] = [];
  let upcoming: Awaited<ReturnType<typeof listEventsForUser>> = [];

  function computeUpcoming(events: Awaited<ReturnType<typeof listEventsForUser>>) {
    return events
      .filter((event) => new Date(event.start_at) >= new Date())
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
      .slice(0, 5);
  }

  if (user.role === "administrator") {
    const [events, statusCounts, queue, conflicts] = await Promise.all([
      listEventsForUser(user),
      getStatusCounts(),
      listReviewQueue(user),
      findConflicts()
    ]);

    upcoming = computeUpcoming(events);

    cards.push(
      <Card key="status">
        <CardHeader>
          <CardTitle>Pipeline at a glance</CardTitle>
          <CardDescription>See how the workflow is tracking right now.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {Object.entries(statusCounts).map(([status, count]) => (
            <div key={status} className="rounded-[var(--radius)] border border-[rgba(39,54,64,0.12)] bg-white/80 px-4 py-3 shadow-soft">
              <p className="text-sm text-subtle">{status.replace(/_/g, " ")}</p>
              <p className="text-2xl font-semibold text-[var(--color-primary-700)]">{count}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    );

    cards.push(
      <Card key="queue">
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle>Reviews needing attention</CardTitle>
            <CardDescription>Work with reviewers to keep things moving.</CardDescription>
          </div>
          <Button asChild variant="secondary">
            <Link href="/reviews">Open queue</Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {queue.slice(0, 4).map((event) => (
            <div key={event.id} className="flex flex-col gap-1 rounded-[var(--radius)] border border-[rgba(39,54,64,0.12)] bg-white/80 px-4 py-3 text-sm shadow-soft md:flex-row md:items-center md:justify-between">
              <div>
                <Link
                  href={`/events/${event.id}`}
                  className="font-medium text-[var(--color-text)] transition-colors hover:text-[var(--color-primary-600)]"
                >
                  {event.title}
                </Link>
                <p className="text-subtle">{event.venue?.name ?? ""} · {new Date(event.start_at).toLocaleString("en-GB")}</p>
              </div>
              <Badge variant="info">{event.status.replace(/_/g, " ")}</Badge>
            </div>
          ))}
          {queue.length === 0 ? <p className="text-sm text-subtle">All caught up.</p> : null}
        </CardContent>
      </Card>
    );

    cards.push(
      <Card key="conflicts">
        <CardHeader>
          <CardTitle>Potential clashes</CardTitle>
          <CardDescription>Look out for overlapping events in the same space.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {conflicts.length === 0 ? (
            <p className="text-sm text-subtle">No conflicts spotted in upcoming plans.</p>
          ) : (
            conflicts.map((pair, index) => (
              <div key={`${pair.event.id}-${index}`} className="rounded-[var(--radius)] border border-[rgba(110,60,61,0.3)] bg-white/80 px-4 py-3 text-sm text-[var(--color-antique-burgundy)] shadow-soft">
                <Link
                  href={`/events/${pair.event.id}`}
                  className="font-semibold transition-colors hover:text-[var(--color-primary-600)]"
                >
                  {pair.event.title}
                </Link>
                <p>
                  Overlaps with{" "}
                  <Link
                    href={`/events/${pair.conflictingWith.id}`}
                    className="font-medium transition-colors hover:text-[var(--color-primary-600)]"
                  >
                    {pair.conflictingWith.title}
                  </Link>{" "}
                  in {pair.event.venue_space} – {pair.event.venue?.name}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    );
  } else {
    const events = await listEventsForUser(user);
    upcoming = computeUpcoming(events);
  }

  cards.push(
    <Card key="upcoming">
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle>{user.role === "office_worker" ? "Upcoming at your venue" : "Next confirmed events"}</CardTitle>
          <CardDescription>Keep everyone lined up for the week ahead.</CardDescription>
        </div>
        {(user.role === "office_worker" || user.role === "administrator") && (
          <Button asChild>
            <Link href="/events/new">New Event</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {upcoming.length === 0 ? (
          <p className="text-sm text-subtle">Nothing upcoming yet.</p>
        ) : (
          upcoming.map((event) => (
            <div key={event.id} className="flex flex-col gap-1 rounded-[var(--radius)] border border-[rgba(39,54,64,0.12)] bg-white/80 px-4 py-3 text-sm shadow-soft md:flex-row md:items-center md:justify-between">
              <div>
                <Link
                  href={`/events/${event.id}`}
                  className="font-medium text-[var(--color-text)] transition-colors hover:text-[var(--color-primary-600)]"
                >
                  {event.title}
                </Link>
                <p className="text-subtle">{event.venue?.name ?? ""} · {new Date(event.start_at).toLocaleString("en-GB")}</p>
              </div>
              <Badge variant="neutral">{event.status.replace(/_/g, " ")}</Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-brand-serif text-3xl text-[var(--color-primary-700)]">{copy.heading}</h1>
          <p className="mt-2 max-w-2xl text-base text-subtle">{copy.body}</p>
        </div>
        {user.role === "office_worker" && (
          <Button asChild>
            <Link href="/events/new">New Event</Link>
          </Button>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">{cards}</div>
    </div>
  );
}
