import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DecisionForm } from "@/components/reviews/decision-form";
import { getCurrentUser } from "@/lib/auth";
import { listReviewQueue } from "@/lib/events";
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

  if (user.role === "venue_manager" || user.role === "executive") {
    redirect("/");
  }

  const queue = await listReviewQueue(user);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-brand-serif text-3xl text-[var(--color-primary-700)]">
          {user.role === "central_planner" ? "Review pipeline" : "My review queue"}
        </h1>
        <p className="mt-1 text-subtle">Work through the newest submissions first and leave clear feedback.</p>
      </div>

      <div className="grid gap-4">
        {queue.map((event) => {
          const tone = statusTone[event.status] ?? "neutral";
          const spaces = parseVenueSpaces(event.venue_space);
          const spaceLabel = spaces.length > 1 ? "Spaces" : "Space";
          const spaceDisplay = spaces.length ? spaces.join(", ") : "Not specified";
          return (
            <Card key={event.id} className="border-[rgba(39,54,64,0.12)]">
              <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-xl text-[var(--color-primary-700)]">
                    <Link href={`/events/${event.id}`} className="transition-colors hover:text-[var(--color-primary-500)]">
                      {event.title}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    {event.venue?.name ?? ""} · {timeFormat.format(new Date(event.start_at))}
                  </CardDescription>
                </div>
                <Badge variant={tone}>{event.status.replace("_", " ")}</Badge>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-[2fr_1fr] md:items-center">
                <div className="text-sm text-muted">
                  <p>
                    {spaceLabel}: <span className="font-medium text-[var(--color-text)]">{spaceDisplay}</span>
                  </p>
                  <p>Type: <span className="font-medium text-[var(--color-text)]">{event.event_type}</span></p>
                  <p>
                    Submitted: <span className="font-medium text-[var(--color-text)]">{event.submitted_at ? timeFormat.format(new Date(event.submitted_at)) : "Draft"}</span>
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  {user.role === "reviewer" && event.assignee_id === user.id ? (
                    <DecisionForm eventId={event.id} />
                  ) : (
                    <Button variant="secondary" asChild>
                      <Link href={`/events/${event.id}`}>Open event</Link>
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
              {user.role === "reviewer" ? "Nothing waiting for you right now." : "All clear—no submissions waiting."}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
