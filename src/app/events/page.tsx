import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/auth";
import { listEventsForUser } from "@/lib/events";

const statusCopy: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Waiting review", tone: "info" },
  needs_revisions: { label: "Needs tweaks", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  completed: { label: "Completed", tone: "success" }
};

function formatDateRange(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });

  return `${formatter.format(startDate)} → ${formatter.format(endDate)}`;
}

export default async function EventsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const events = await listEventsForUser(user);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-brand-serif text-3xl text-[var(--color-primary-700)]">
            {user.role === "venue_manager" ? "My events" : "Events overview"}
          </h1>
          <p className="mt-1 text-subtle">
            Track drafts, submissions, and approved plans in one place.
          </p>
        </div>
        {(user.role === "venue_manager" || user.role === "central_planner") && (
          <Button asChild>
            <Link href="/events/new">New draft</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4">
        {events.map((event) => {
          const status = statusCopy[event.status] ?? statusCopy.draft;
          return (
            <Card key={event.id} className="border-[rgba(39,54,64,0.1)]">
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-xl text-[var(--color-primary-700)]">{event.title}</CardTitle>
                  <CardDescription>
                    {event.venue?.name ?? ""} · {formatDateRange(event.start_at, event.end_at)}
                  </CardDescription>
                </div>
                <Badge variant={status.tone}>{status.label}</Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-muted">
                  <p>Type: <span className="font-medium text-[var(--color-text)]">{event.event_type}</span></p>
                  <p>Space: <span className="font-medium text-[var(--color-text)]">{event.venue_space}</span></p>
                </div>
                <Button variant="secondary" asChild>
                  <Link href={`/events/${event.id}`}>Open details</Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}

        {events.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-subtle">
              No events yet. Start by creating a draft.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
