import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/design-primitives";
import { DecisionForm } from "@/components/reviews/decision-form";
import { getCurrentUser } from "@/lib/auth";
import { listReviewQueue } from "@/lib/events";
import { canViewReviews, canReviewEvents } from "@/lib/roles";
import { parseVenueSpaces } from "@/lib/venue-spaces";

const statusTone: Record<string, "info" | "warning" | "success" | "neutral"> = {
  submitted: "info",
  needs_revisions: "warning",
  approved: "success"
};

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit"
});

export default async function ReviewsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  if (!canViewReviews(user.role)) {
    redirect("/unauthorized");
  }

  const queue = await listReviewQueue(user);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Approvals"
        title="Review pipeline"
        description="Work through the newest submissions first and leave clear feedback."
        meta={<span>{queue.length} item{queue.length === 1 ? "" : "s"} waiting</span>}
      />

      <div className="grid gap-4">
        {queue.map((event) => {
          const tone = statusTone[event.status] ?? "neutral";
          const spaces = parseVenueSpaces(event.venue_space);
          const spaceLabel = spaces.length > 1 ? "Spaces" : "Space";
          const spaceDisplay = spaces.length ? spaces.join(", ") : "Not specified";
          return (
            <Card key={event.id} className="mobile-card md:rounded-[var(--radius-lg)]">
              <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-xl text-[var(--navy)]">
                    <Link href={`/events/${event.id}`} className="transition-colors hover:text-[var(--slate)]">
                      {event.title}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    {event.venue?.name ?? ""} · {event.start_at ? timeFormat.format(new Date(event.start_at)) : "Date not set"}
                  </CardDescription>
                </div>
                <Badge variant={tone}>{event.status.replace(/_/g, " ")}</Badge>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-[1fr_2fr] md:items-center">
                <div className="text-sm text-muted">
                  <p>
                    {spaceLabel}: <span className="font-medium text-[var(--ink)]">{spaceDisplay}</span>
                  </p>
                  <p>Type: <span className="font-medium text-[var(--ink)]">{event.event_type}</span></p>
                  <p>
                    Submitted: <span className="font-medium text-[var(--ink)]">{event.submitted_at ? timeFormat.format(new Date(event.submitted_at)) : "Draft"}</span>
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  {canReviewEvents(user.role) ? (
                    <DecisionForm eventId={event.id} />
                  ) : (
                    <Button variant="secondary" asChild>
                      <Link href={`/events/${event.id}`}>View event</Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {queue.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-subtle">
              {"All clear—no submissions waiting."}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
