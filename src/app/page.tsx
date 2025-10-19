import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { getStatusCounts, listEventsForUser, listReviewQueue, findConflicts } from "@/lib/events";

const roleCopy: Record<string, { heading: string; body: string }> = {
  central_planner: {
    heading: "Today’s planning view",
    body: "Check in on pending submissions, watch for clashes, and keep the pipeline moving."
  },
  reviewer: {
    heading: "Your review queue",
    body: "Look over new requests, give quick feedback, and keep venues informed."
  },
  venue_manager: {
    heading: "Your upcoming plans",
    body: "Draft fresh ideas, tidy earlier submissions, and stay on top of reviewer notes."
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

  const copy = roleCopy[user.role] ?? roleCopy["central_planner"];
  const events = await listEventsForUser(user);
  const upcoming = events
    .filter((event) => new Date(event.start_at) >= new Date())
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    .slice(0, 5);

  const cards: ReactNode[] = [];

  if (user.role === "central_planner") {
    const [statusCounts, queue, conflicts] = await Promise.all([
      getStatusCounts(),
      listReviewQueue(user),
      findConflicts()
    ]);

    cards.push(
      <Card key="status">
        <CardHeader>
          <CardTitle>Pipeline at a glance</CardTitle>
          <CardDescription>See how the workflow is tracking right now.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {Object.entries(statusCounts).map(([status, count]) => (
            <div key={status} className="rounded-[var(--radius)] border border-[rgba(39,54,64,0.12)] bg-white/80 px-4 py-3 shadow-soft">
              <p className="text-sm text-subtle">{status.replace("_", " ")}</p>
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
                <p className="font-medium text-[var(--color-text)]">{event.title}</p>
                <p className="text-subtle">{event.venue?.name ?? ""} · {new Date(event.start_at).toLocaleString("en-GB")}</p>
              </div>
              <Badge variant="info">{event.status.replace("_", " ")}</Badge>
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
                <p className="font-semibold">{pair.event.title}</p>
                <p>Overlaps with <span className="font-medium">{pair.conflictingWith.title}</span> in {pair.event.venue_space} – {pair.event.venue?.name}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    );
  } else if (user.role === "reviewer") {
    const queue = await listReviewQueue(user);
    cards.push(
      <Card key="queue">
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle>Your queue</CardTitle>
            <CardDescription>Pick off the oldest submissions first.</CardDescription>
          </div>
          <Button asChild variant="secondary">
            <Link href="/reviews">Open queue</Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {queue.slice(0, 5).map((event) => (
            <div key={event.id} className="rounded-[var(--radius)] border border-[rgba(39,54,64,0.12)] bg-white/80 px-4 py-3 text-sm shadow-soft">
              <p className="font-medium text-[var(--color-text)]">{event.title}</p>
              <p className="text-subtle">{event.venue?.name ?? ""} · {new Date(event.start_at).toLocaleString("en-GB")}</p>
            </div>
          ))}
          {queue.length === 0 ? <p className="text-sm text-subtle">No reviews waiting.</p> : null}
        </CardContent>
      </Card>
    );
  }

  cards.push(
    <Card key="upcoming">
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle>{user.role === "venue_manager" ? "Upcoming at your venue" : "Next confirmed events"}</CardTitle>
          <CardDescription>Keep everyone lined up for the week ahead.</CardDescription>
        </div>
        {(user.role === "venue_manager" || user.role === "central_planner") && (
          <Button asChild>
            <Link href="/events/new">New draft</Link>
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
                <p className="font-medium text-[var(--color-text)]">{event.title}</p>
                <p className="text-subtle">{event.venue?.name ?? ""} · {new Date(event.start_at).toLocaleString("en-GB")}</p>
              </div>
              <Badge variant="neutral">{event.status.replace("_", " ")}</Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-brand-serif text-3xl text-[var(--color-primary-700)]">{copy.heading}</h1>
        <p className="mt-2 max-w-2xl text-base text-subtle">{copy.body}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">{cards}</div>
    </div>
  );
}
