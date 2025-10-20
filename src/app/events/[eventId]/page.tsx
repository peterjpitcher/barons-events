import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventForm } from "@/components/events/event-form";
import { DecisionForm } from "@/components/reviews/decision-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { getCurrentUser } from "@/lib/auth";
import { getEventDetail } from "@/lib/events";
import { generateEventMeta } from "@/lib/ai";
import { EVENT_GOALS_BY_VALUE, humanizeGoalValue, parseGoalFocus } from "@/lib/event-goals";
import { listAuditLogForEvent } from "@/lib/audit-log";
import { listVenuesWithAreas } from "@/lib/venues";
import { listEventTypes } from "@/lib/event-types";
import { listAssignableUsers, getUsersByIds } from "@/lib/users";
import { updateAssigneeAction } from "@/actions/events";

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

const auditTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short"
});

const toMetaRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

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
  const goalValues = parseGoalFocus(event.goal_focus);
  const goalDetails = Array.from(new Set(goalValues)).map((value) => {
    const config = EVENT_GOALS_BY_VALUE[value];
    return {
      value,
      label: config?.label ?? humanizeGoalValue(value),
      helper: config?.helper ?? null
    };
  });
  const hasGoalDetails = goalDetails.length > 0;

  const canEdit =
    (user.role === "central_planner" || (user.role === "venue_manager" && event.created_by === user.id)) &&
    ["draft", "needs_revisions"].includes(event.status);
  const canReview =
    (user.role === "reviewer" && event.assignee_id === user.id && ["submitted", "needs_revisions"].includes(event.status)) ||
    (user.role === "central_planner" && ["submitted", "needs_revisions"].includes(event.status));
  const canSubmitDebrief =
    (user.role === "venue_manager" && event.created_by === user.id && ["approved", "completed"].includes(event.status)) ||
    (user.role === "central_planner" && ["approved", "completed"].includes(event.status));
  const canUpdateAssignee = user.role === "central_planner";

  const reassignAssignee = async (formData: FormData) => {
    "use server";
    await updateAssigneeAction(formData);
  };

  const [venues, assignableUsers, eventTypes, auditLog] = await Promise.all([
    listVenuesWithAreas(),
    listAssignableUsers(),
    listEventTypes(),
    listAuditLogForEvent(event.id)
  ]);

  const actorIds = new Set<string>();
  actorIds.add(event.created_by);
  if (event.assignee_id) {
    actorIds.add(event.assignee_id);
  }
  event.approvals.forEach((approval) => {
    if (approval.reviewer_id) {
      actorIds.add(approval.reviewer_id);
    }
  });
  auditLog.forEach((entry) => {
    if (entry.actor_id) {
      actorIds.add(entry.actor_id);
    }
    const meta = toMetaRecord(entry.meta);
    const assigneeFromLog = typeof meta.assigneeId === "string" ? meta.assigneeId : null;
    const previousAssigneeFromLog =
      typeof meta.previousAssigneeId === "string" ? meta.previousAssigneeId : null;
    if (assigneeFromLog) {
      actorIds.add(assigneeFromLog);
    }
    if (previousAssigneeFromLog) {
      actorIds.add(previousAssigneeFromLog);
    }
  });

  let userDirectory: Record<string, { id: string; name: string; email: string }> = {};
  try {
    userDirectory = await getUsersByIds(Array.from(actorIds));
  } catch (error) {
    console.error("Could not resolve actor names", error);
  }

  const assignableDirectory = new Map(assignableUsers.map((person) => [person.id, person]));

  const resolveUserName = (id: string | null | undefined): string => {
    if (!id) {
      return "Unassigned";
    }
    return userDirectory[id]?.name ?? assignableDirectory.get(id)?.name ?? "Unknown user";
  };

  const formatStatusLabel = (value: string | null): string | null => {
    if (!value) return null;
    const match = statusCopy[value];
    if (match) return match.label;
    return value.replace(/_/g, " ");
  };

  const auditEntries = auditLog.map((entry) => {
    const meta = toMetaRecord(entry.meta);
    const changeLabels = toStringArray(meta.changes);
    const statusValue = typeof meta.status === "string" ? meta.status : null;
    const previousStatus = typeof meta.previousStatus === "string" ? meta.previousStatus : null;
    const assigneeIdFromMeta = typeof meta.assigneeId === "string" ? meta.assigneeId : null;
    const previousAssigneeIdFromMeta =
      typeof meta.previousAssigneeId === "string" ? meta.previousAssigneeId : null;
    const feedbackText =
      typeof meta.feedback === "string" && meta.feedback.trim().length ? meta.feedback.trim() : null;

    const createdAt = new Date(entry.created_at);
    const hasValidTimestamp = !Number.isNaN(createdAt.getTime());
    const timestampLabel = hasValidTimestamp ? auditTimestampFormatter.format(createdAt) : entry.created_at;

    let summary = "Activity recorded";
    const details: string[] = [];

    if (statusValue) {
      const currentLabel = formatStatusLabel(statusValue) ?? statusValue;
      const previousLabel =
        previousStatus && previousStatus !== statusValue ? formatStatusLabel(previousStatus) ?? previousStatus : null;
      let line = `Status: ${currentLabel}`;
      if (previousLabel) {
        line += ` (was ${previousLabel})`;
      }
      details.push(line);
    }

    if (assigneeIdFromMeta || previousAssigneeIdFromMeta) {
      const currentAssigneeName = resolveUserName(assigneeIdFromMeta);
      const previousAssigneeName =
        previousAssigneeIdFromMeta && previousAssigneeIdFromMeta !== assigneeIdFromMeta
          ? resolveUserName(previousAssigneeIdFromMeta)
          : null;
      let line = `Assignee: ${currentAssigneeName}`;
      if (previousAssigneeName) {
        line += ` (was ${previousAssigneeName})`;
      }
      details.push(line);
    }

    if (changeLabels.length) {
      details.push(`Changed: ${changeLabels.join(", ")}`);
    }

    switch (entry.action) {
      case "event.created":
        summary = "Draft created";
        break;
      case "event.updated":
        summary = "Draft updated";
        break;
      case "event.status_submitted":
        summary = "Submitted for review";
        break;
      case "event.status_changed":
        summary = statusValue ? `Status changed to ${formatStatusLabel(statusValue) ?? statusValue}` : "Status updated";
        break;
      case "event.assignee_updated":
        summary = assigneeIdFromMeta ? "Assignee updated" : "Assignee cleared";
        break;
      default: {
        const cleaned = entry.action.replace(/^event\\./, "").replace(/_/g, " ");
        summary = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        break;
      }
    }

    return {
      id: entry.id,
      actorName: resolveUserName(entry.actor_id),
      timestampLabel,
      createdAtIso: hasValidTimestamp ? createdAt.toISOString() : null,
      summary,
      details,
      feedback: feedbackText
    };
  });

  const aiMeta = event.status === "approved" ? await generateEventMeta(event) : null;
  const currentAssigneeName = resolveUserName(event.assignee_id);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <Badge variant={status.tone}>{status.label}</Badge>
            <CardTitle className="text-2xl text-[var(--color-primary-700)]">
              <Link href={`/events/${event.id}`} className="transition-colors hover:text-[var(--color-primary-500)]">
                {event.title}
              </Link>
            </CardTitle>
            <CardDescription>
              {event.venue?.name ?? ""} · {formatter.format(new Date(event.start_at))} →{" "}
              {formatter.format(new Date(event.end_at))}
            </CardDescription>
          </div>
          <div className="flex flex-col items-start gap-1 text-xs text-subtle lg:items-end">
            <span>
              <span className="font-semibold text-[var(--color-text)]">Assignee:</span> {currentAssigneeName}
            </span>
            <span>
              <span className="font-semibold text-[var(--color-text)]">Created by:</span>{" "}
              {event.created_by === user.id ? "You" : resolveUserName(event.created_by)}
            </span>
          </div>
        </CardHeader>
      </Card>

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Event details</CardTitle>
              <CardDescription>Core context for planners, reviewers, and venue teams.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted">
              {event.notes ? (
                <div className="space-y-1 text-[var(--color-text)]">
                  <p className="font-semibold">Notes</p>
                  <p className="whitespace-pre-wrap text-sm text-subtle">{event.notes}</p>
                </div>
              ) : null}
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <p>
                  <span className="font-semibold text-[var(--color-text)]">Type:</span> {event.event_type}
                </p>
                <p>
                  <span className="font-semibold text-[var(--color-text)]">Space:</span> {event.venue_space}
                </p>
                <p>
                  <span className="font-semibold text-[var(--color-text)]">Start:</span>{" "}
                  {formatter.format(new Date(event.start_at))}
                </p>
                <p>
                  <span className="font-semibold text-[var(--color-text)]">End:</span>{" "}
                  {formatter.format(new Date(event.end_at))}
                </p>
                {event.expected_headcount ? (
                  <p>
                    <span className="font-semibold text-[var(--color-text)]">Headcount:</span>{" "}
                    {event.expected_headcount}
                  </p>
                ) : null}
                {event.wet_promo ? (
                  <p>
                    <span className="font-semibold text-[var(--color-text)]">Wet promo:</span> {event.wet_promo}
                  </p>
                ) : null}
                {event.food_promo ? (
                  <p>
                    <span className="font-semibold text-[var(--color-text)]">Food promo:</span> {event.food_promo}
                  </p>
                ) : null}
              </div>
              {hasGoalDetails ? (
                <div className="space-y-2">
                  <p className="font-semibold text-[var(--color-text)]">Goals</p>
                  <div className="space-y-2">
                    {goalDetails.map((goal) => (
                      <div key={goal.value}>
                        <p className="font-medium text-[var(--color-text)]">{goal.label}</p>
                        {goal.helper ? <p className="text-xs text-subtle">{goal.helper}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Marketing metadata</CardTitle>
              <CardDescription>Auto-generated copy to help publish the event on the website.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {event.status !== "approved" ? (
                <p className="text-sm text-subtle">
                  We generate SEO copy once the event is approved. Approve the event to unlock the meta details.
                </p>
              ) : aiMeta ? (
                <dl className="grid gap-3 md:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.15em] text-subtle">Meta title</dt>
                    <dd className="mt-1 text-sm text-[var(--color-text)]">{aiMeta.metaTitle}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.15em] text-subtle">Meta description</dt>
                    <dd className="mt-1 text-sm text-[var(--color-text)]">{aiMeta.metaDescription}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.15em] text-subtle">Slug</dt>
                    <dd className="mt-1 font-mono text-sm text-[var(--color-primary-700)]">{aiMeta.slug}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.15em] text-subtle">Short teaser</dt>
                    <dd className="mt-1 text-sm text-[var(--color-text)]">{aiMeta.teaser}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-danger">
                  Couldn&apos;t generate metadata. Check the AI service credentials and try again.
                </p>
              )}
            </CardContent>
          </Card>

          {canEdit ? (
            <EventForm
              mode="edit"
              defaultValues={event}
              venues={venues}
              eventTypes={eventTypes.map((type) => type.label)}
              role={user.role}
              userVenueId={user.venueId}
            />
          ) : null}

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
                      Debrief submitted {new Date(event.debrief.submitted_at).toLocaleDateString("en-GB")}. You can update
                      it if figures change.
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

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
              <CardDescription>Send the next action to the right teammate.</CardDescription>
            </CardHeader>
            <CardContent>
              {canUpdateAssignee ? (
                <form className="space-y-3 text-sm" action={reassignAssignee}>
                  <div className="space-y-2">
                    <label htmlFor="assigneeId" className="font-semibold text-[var(--color-text)]">
                      Assignee
                    </label>
                    <Select
                      id="assigneeId"
                      name="assigneeId"
                      defaultValue={event.assignee_id ?? ""}
                      aria-label="Choose assignee"
                    >
                      <option value="">Unassigned</option>
                      {assignableUsers.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name} · {person.role.replace("_", " ")}
                        </option>
                      ))}
                    </Select>
                    <p className="text-xs text-subtle">
                      Assign the next action to a reviewer, planner, or the submitting venue manager.
                    </p>
                  </div>
                  <input type="hidden" name="eventId" value={event.id} />
                  <div className="flex justify-end">
                    <SubmitButton label="Update" pendingLabel="Updating..." variant="secondary" className="px-4 py-1" />
                  </div>
                </form>
              ) : (
                <p className="text-sm text-muted">
                  <span className="font-semibold text-[var(--color-text)]">Assignee:</span> {currentAssigneeName}
                </p>
              )}
            </CardContent>
          </Card>

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
              <CardTitle>Reviewer timeline</CardTitle>
              <CardDescription>Quick view of submissions and reviewer notes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {event.approvals.length === 0 ? (
                <p className="text-sm text-subtle">No reviewer decisions recorded yet.</p>
              ) : (
                event.approvals.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-[var(--radius)] border border-[rgba(39,54,64,0.1)] bg-white/80 px-4 py-3 text-sm shadow-soft"
                  >
                    <p className="font-semibold text-[var(--color-text)] capitalize">{entry.decision.replace("_", " ")}</p>
                    <p className="text-xs text-subtle">
                      {resolveUserName(entry.reviewer_id)} · {new Date(entry.decided_at).toLocaleString("en-GB")}
                    </p>
                    {entry.feedback_text ? (
                      <p className="mt-2 text-[var(--color-text)]">{entry.feedback_text}</p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit trail</CardTitle>
              <CardDescription>Track status changes, assignments, and reviewer feedback.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {auditEntries.length === 0 ? (
                <p className="text-sm text-subtle">No activity recorded yet.</p>
              ) : (
                auditEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-[var(--radius)] border border-[rgba(39,54,64,0.1)] bg-white/80 px-4 py-3 text-sm text-[var(--color-text)] shadow-soft"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold text-[var(--color-text)]">{entry.summary}</p>
                      <time dateTime={entry.createdAtIso ?? undefined} className="text-xs text-subtle">
                        {entry.timestampLabel}
                      </time>
                    </div>
                    <p className="mt-1 text-xs text-subtle">By {entry.actorName}</p>
                    {entry.details.length ? (
                      <ul className="mt-2 space-y-1 text-xs">
                        {entry.details.map((detail, index) => (
                          <li key={`${entry.id}-detail-${index}`} className="flex items-start gap-2">
                            <span
                              className="mt-[0.35rem] h-1.5 w-1.5 flex-none rounded-full bg-[var(--color-primary-400)]"
                              aria-hidden="true"
                            />
                            <span>{detail}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {entry.feedback ? (
                      <p className="mt-3 rounded-[var(--radius)] bg-[rgba(39,54,64,0.06)] p-3 text-sm leading-relaxed text-[var(--color-text)]">
                        {entry.feedback}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
