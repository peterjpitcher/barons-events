import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventForm } from "@/components/events/event-form";
import { DecisionForm } from "@/components/reviews/decision-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { getEventDetail } from "@/lib/events";
import { listVenuesWithAreas } from "@/lib/venues";
import { listReviewers } from "@/lib/reviewers";
import { listEventTypes } from "@/lib/event-types";

const statusCopy: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Waiting review", tone: "info" },
  needs_revisions: { label: "Needs tweaks", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  completed: { label: "Completed", tone: "success" }
};

const formatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit"
});

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const event = await getEventDetail(eventId);
  if (!event) {
    notFound();
  }

  const status = statusCopy[event.status] ?? statusCopy.draft;

  const canEdit =
    (user.role === "central_planner" || (user.role === "venue_manager" && event.created_by === user.id)) &&
    ["draft", "needs_revisions"].includes(event.status);

  const canReview =
    (user.role === "reviewer" && event.assigned_reviewer_id === user.id && ["submitted", "needs_revisions"].includes(event.status)) ||
    (user.role === "central_planner" && ["submitted", "needs_revisions"].includes(event.status));

  const canSubmitDebrief =
    (user.role === "venue_manager" && event.created_by === user.id && ["approved", "completed"].includes(event.status)) ||
    (user.role === "central_planner" && ["approved", "completed"].includes(event.status));

  const [venues, reviewers, eventTypes] = await Promise.all([
    listVenuesWithAreas(),
    listReviewers(),
    listEventTypes()
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Badge variant={status.tone}>{status.label}</Badge>
            <CardTitle className="mt-2 text-2xl text-[var(--color-primary-700)]">{event.title}</CardTitle>
            <CardDescription>
              {event.venue?.name ?? ""} · {formatter.format(new Date(event.start_at))} → {formatter.format(new Date(event.end_at))}
            </CardDescription>
          </div>
          <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-white/80 px-4 py-3 text-sm text-subtle shadow-soft">
            <p>
              Reviewer: <span className="font-medium text-[var(--color-text)]">{event.assigned_reviewer_id ? reviewers.find((r) => r.id === event.assigned_reviewer_id)?.name ?? "Assigned" : "Unassigned"}</span>
            </p>
            <p>
              Created by: <span className="font-medium text-[var(--color-text)]">{event.created_by === user.id ? "You" : event.venue?.name ?? ""}</span>
            </p>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm text-muted md:grid-cols-2">
          <div>
            <p><span className="font-semibold text-[var(--color-text)]">Type:</span> {event.event_type}</p>
            <p><span className="font-semibold text-[var(--color-text)]">Space:</span> {event.venue_space}</p>
            {event.expected_headcount ? <p><span className="font-semibold text-[var(--color-text)]">Headcount:</span> {event.expected_headcount}</p> : null}
          </div>
          <div>
            {event.wet_promo ? <p><span className="font-semibold text-[var(--color-text)]">Wet promo:</span> {event.wet_promo}</p> : null}
            {event.food_promo ? <p><span className="font-semibold text-[var(--color-text)]">Food promo:</span> {event.food_promo}</p> : null}
            {event.goal_focus ? <p><span className="font-semibold text-[var(--color-text)]">Focus:</span> {event.goal_focus}</p> : null}
          </div>
        </CardContent>
      </Card>

      {canEdit ? (
        <EventForm
          mode="edit"
          defaultValues={event}
          venues={venues}
          reviewers={reviewers}
          eventTypes={eventTypes.map((type) => type.label)}
          role={user.role}
          userVenueId={user.venueId}
        />
      ) : null}

      {canReview ? (
        <Card>
          <CardHeader>
            <CardTitle>Review decision</CardTitle>
            <CardDescription>Share a clear decision so the venue knows what to do next.</CardDescription>
          </CardHeader>
          <CardContent>
            <DecisionForm eventId={event.id} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>Quick view of submissions and reviewer notes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {event.approvals.length === 0 ? <p className="text-sm text-subtle">No reviewer decisions recorded yet.</p> : null}
          {event.approvals.map((entry) => (
            <div key={entry.id} className="rounded-[var(--radius)] border border-[rgba(39,54,64,0.1)] bg-white/80 px-4 py-3 text-sm shadow-soft">
              <p className="font-semibold text-[var(--color-text)] capitalize">{entry.decision.replace("_", " ")}</p>
              <p className="text-subtle">{new Date(entry.decided_at).toLocaleString("en-GB")}</p>
              {entry.feedback_text ? <p className="mt-2 text-[var(--color-text)]">{entry.feedback_text}</p> : null}
            </div>
          ))}
        </CardContent>
      </Card>

      {canSubmitDebrief ? (
        <Card>
          <CardHeader>
            <CardTitle>Post-event debrief</CardTitle>
            <CardDescription>Capture attendance and takings as soon as possible.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-muted">
              {event.debrief ? (
                <p>
                  Debrief submitted {new Date(event.debrief.submitted_at).toLocaleDateString("en-GB")}. You can update it if figures change.
                </p>
              ) : (
                <p>No debrief yet. Please add it after the event.</p>
              )}
            </div>
            <Button asChild variant="secondary">
              <Link href={`/debriefs/${event.id}`}>{event.debrief ? "Update debrief" : "Add debrief"}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
