import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventForm } from "@/components/events/event-form";
import { EventFormActions } from "@/components/events/event-form-actions";
import { BookingSettingsCard } from "@/components/events/booking-settings-card";
import { EventDetailSummary } from "@/components/events/event-detail-summary";
import { DeleteEventButton } from "@/components/events/delete-event-button";
import { RevertToDraftButton } from "@/components/events/revert-to-draft-button";
import { DecisionForm } from "@/components/reviews/decision-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { getCurrentUser } from "@/lib/auth";
import { getEventDetail } from "@/lib/events";
import { EVENT_GOALS_BY_VALUE, humanizeGoalValue, parseGoalFocus } from "@/lib/event-goals";
import { listAuditLogForEvent } from "@/lib/audit-log";
import { listVenues } from "@/lib/venues";
import { listEventTypes } from "@/lib/event-types";
import { listArtists } from "@/lib/artists";
import { listAssignableUsers, getUsersByIds } from "@/lib/users";
import { updateAssigneeAction } from "@/actions/events";
import { parseVenueSpaces } from "@/lib/venue-spaces";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canViewPlanning } from "@/lib/roles";
import { SopChecklistView } from "@/components/planning/sop-checklist-view";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";
import { ProposalDecisionCard } from "@/components/events/proposal-decision-card";
import { listEventAttachmentsRollup } from "@/lib/attachments";
import type { PlanningTask, PlanningPerson, PlanningTaskStatus } from "@/lib/planning/types";

const statusCopy: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending_approval: { label: "Proposal — awaiting approval", tone: "info" },
  approved_pending_details: { label: "Approved — add details", tone: "info" },
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
  minute: "2-digit",
  timeZone: "Europe/London"
});

const auditTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London"
});

const bookingTypeLabel: Record<string, string> = {
  ticketed: "Ticketed event",
  table_booking: "Table booking event",
  free_entry: "Free entry",
  mixed: "Mixed booking model"
};

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

  // Venue-scoped permission: office_worker can act on events at their venue (not just events they created)
  const isVenueScoped =
    user.role === "office_worker" &&
    user.venueId != null &&
    event.venue_id === user.venueId;

  // Pre-event proposal creators (any role) can continue editing their own
  // proposal once an admin approves it, so they can fill in the remaining
  // details. The saveEventDraftAction auto-transitions
  // approved_pending_details → draft once required fields are provided.
  const isCreator = event.created_by === user.id;

  const canEdit =
    (user.role === "administrator" &&
      ["draft", "submitted", "needs_revisions", "approved", "approved_pending_details"].includes(event.status)) ||
    (isVenueScoped && ["draft", "needs_revisions", "approved_pending_details"].includes(event.status)) ||
    (isCreator && event.status === "approved_pending_details");
  const canReview =
    (user.role === "administrator" && ["submitted", "needs_revisions"].includes(event.status));
  const canPreReview =
    user.role === "administrator" && event.status === "pending_approval";
  const canSubmitDebrief =
    (isVenueScoped && ["approved", "completed"].includes(event.status)) ||
    (user.role === "administrator" && ["approved", "completed"].includes(event.status));
  const canUpdateAssignee = user.role === "administrator";
  const canDelete =
    user.role === "administrator" ||
    (isVenueScoped && ["draft", "needs_revisions"].includes(event.status));
  const canRevertToDraft = event.status === "approved" && user.role === "administrator";

  const reassignAssignee = async (formData: FormData) => {
    "use server";
    await updateAssigneeAction(formData);
  };

  const [venues, assignableUsers, eventTypes, auditLog, artists, attachments] = await Promise.all([
    listVenues(),
    listAssignableUsers(),
    listEventTypes(),
    listAuditLogForEvent(event.id),
    listArtists(),
    listEventAttachmentsRollup(event.id)
  ]);

  const canUploadAttachments = user.role === "administrator" || isVenueScoped;

  // ─── Fetch linked planning item & SOP tasks for this event ────────────────
  let sopTasks: PlanningTask[] = [];
  let sopPlanningItemId: string | null = null;
  if (canViewPlanning(user.role)) {
    const db = createSupabaseAdminClient();
    const { data: planningItem } = await db
      .from("planning_items")
      .select(`
        id, target_date,
        tasks:planning_tasks(
          id, planning_item_id, title, assignee_id, due_date, status, completed_at, completed_by,
          sort_order, sop_section, sop_template_task_id, is_blocked, due_date_manually_overridden, notes,
          assignee:users!planning_tasks_assignee_id_fkey(id, full_name, email),
          assignees:planning_task_assignees(user:users(id, full_name, email)),
          dependencies:planning_task_dependencies!planning_task_dependencies_task_id_fkey(depends_on_task_id)
        )
      `)
      .eq("event_id", eventId)
      .maybeSingle();

    if (planningItem) {
      sopPlanningItemId = planningItem.id;
      const rawTasks = Array.isArray(planningItem.tasks) ? planningItem.tasks : [];
      type RawUser = { id: string; full_name: string | null; email: string } | null;
      type RawAssigneeJunction = { user: RawUser | RawUser[] | null };
      type RawDep = { depends_on_task_id: string };
      type RawTask = {
        id: string;
        planning_item_id: string;
        title: string;
        assignee_id: string | null;
        due_date: string;
        status: string;
        completed_at: string | null;
        completed_by: string | null;
        sort_order: number;
        sop_section: string | null;
        sop_template_task_id: string | null;
        is_blocked: boolean;
        due_date_manually_overridden: boolean;
        notes: string | null;
        assignee: RawUser | RawUser[] | null;
        assignees: RawAssigneeJunction[];
        dependencies: RawDep[];
      };
      sopTasks = rawTasks.map((task: RawTask): PlanningTask => {
        const assignee = Array.isArray(task.assignee) ? task.assignee[0] : task.assignee;
        const assigneesRaw = Array.isArray(task.assignees) ? task.assignees : [];
        const assignees = assigneesRaw.map((a: RawAssigneeJunction) => {
          const rawUser = a?.user;
          const u = Array.isArray(rawUser) ? rawUser[0] : rawUser;
          return { id: u?.id ?? "", name: u?.full_name ?? u?.email ?? "Unknown", email: u?.email ?? "" };
        });
        return {
          id: task.id,
          planningItemId: task.planning_item_id,
          title: task.title,
          assigneeId: task.assignee_id ?? null,
          assigneeName: assignee?.full_name ?? assignee?.email ?? "To be determined",
          assignees,
          dueDate: task.due_date,
          status: task.status as PlanningTaskStatus,
          completedAt: task.completed_at ?? null,
          completedBy: task.completed_by ?? null,
          sortOrder: task.sort_order ?? 0,
          sopSection: task.sop_section ?? null,
          sopTemplateTaskId: task.sop_template_task_id ?? null,
          isBlocked: task.is_blocked ?? false,
          dueDateManuallyOverridden: task.due_date_manually_overridden ?? false,
          dependsOnTaskIds: Array.isArray(task?.dependencies)
            ? task.dependencies.map((d: RawDep) => d.depends_on_task_id).filter(Boolean)
            : [],
          notes: task.notes ?? null,
        };
      });
    }
  }

  const actorIds = new Set<string>();
  actorIds.add(event.created_by);
  if (event.assignee_id) {
    actorIds.add(event.assignee_id);
  }
  if (event.manager_responsible_id) {
    actorIds.add(event.manager_responsible_id);
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

  const currentAssigneeName = resolveUserName(event.assignee_id);

  // ─── Shared right-column cards ────────────────────────────────────────────

  const assignmentCard = (
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
                    {person.name} · {person.role.replace(/_/g, " ")}
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
  );

  const reviewDecisionCard = canReview ? (
    <Card>
      <CardHeader>
        <CardTitle>Review decision</CardTitle>
        <CardDescription>Share a clear decision so the venue knows what to do next.</CardDescription>
      </CardHeader>
      <CardContent>
        <DecisionForm eventId={event.id} />
      </CardContent>
    </Card>
  ) : null;

  const reviewerTimelineCard = (
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
              <p className="font-semibold text-[var(--color-text)] capitalize">{entry.decision.replace(/_/g, " ")}</p>
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
  );

  const auditTrailCard = (
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
  );

  const debriefSubmitCard = canSubmitDebrief ? (
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
  ) : null;

  const debriefSnapshotCard = event.debrief ? (
    <Card>
      <CardHeader>
        <CardTitle>Debrief snapshot</CardTitle>
        <CardDescription>Commercial outcome and guest sentiment for this event.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm text-muted md:grid-cols-2">
        <p>
          <span className="font-semibold text-[var(--color-text)]">Attendance:</span>{" "}
          {event.debrief.attendance ?? "—"}
          {event.debrief.baseline_attendance != null
            ? ` (baseline ${event.debrief.baseline_attendance})`
            : ""}
        </p>
        <p>
          <span className="font-semibold text-[var(--color-text)]">Event takings:</span>{" "}
          {formatCurrency(event.debrief.actual_total_takings)}
        </p>
        <p>
          <span className="font-semibold text-[var(--color-text)]">Baseline takings:</span>{" "}
          {formatCurrency(event.debrief.baseline_total_takings)}
        </p>
        <p>
          <span className="font-semibold text-[var(--color-text)]">Sales uplift:</span>{" "}
          {formatCurrency(event.debrief.sales_uplift_value)} ({formatPercent(event.debrief.sales_uplift_percent)})
        </p>
        <p>
          <span className="font-semibold text-[var(--color-text)]">Would book again:</span>{" "}
          {event.debrief.would_book_again == null ? "Not answered" : event.debrief.would_book_again ? "Yes" : "No"}
        </p>
        <p>
          <span className="font-semibold text-[var(--color-text)]">Promo score:</span>{" "}
          {event.debrief.promo_effectiveness ?? "—"} / 5
        </p>
        {event.debrief.guest_sentiment_notes ? (
          <p className="md:col-span-2">
            <span className="font-semibold text-[var(--color-text)]">Guest sentiment:</span>{" "}
            {event.debrief.guest_sentiment_notes}
          </p>
        ) : null}
        {event.debrief.next_time_actions ? (
          <p className="md:col-span-2">
            <span className="font-semibold text-[var(--color-text)]">Next time actions:</span>{" "}
            {event.debrief.next_time_actions}
          </p>
        ) : null}
      </CardContent>
    </Card>
  ) : null;

  const sopChecklistCard = sopPlanningItemId && sopTasks.length > 0 ? (
    <Card>
      <CardHeader>
        <CardTitle>SOP Checklist</CardTitle>
        <CardDescription>Pre-event tasks linked to this event&apos;s planning item.</CardDescription>
      </CardHeader>
      <CardContent>
        <SopChecklistView
          tasks={sopTasks}
          users={assignableUsers.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))}
          itemId={sopPlanningItemId}
          currentUserId={user.id}
        />
      </CardContent>
    </Card>
  ) : null;

  return (
    <div className="space-y-6">
      <Link
        href="/events"
        className="inline-flex items-center gap-1 text-sm text-subtle transition-colors hover:text-[var(--color-text)]"
      >
        ← Events
      </Link>

      {/* Header card — always visible */}
      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <CardTitle className="text-2xl text-[var(--color-primary-700)]">
              <Link href={`/events/${event.id}`} className="transition-colors hover:text-[var(--color-primary-500)]">
                {event.title}
              </Link>
            </CardTitle>
            <Badge variant={status.tone}>{status.label}</Badge>
            <CardDescription>
              {event.venue?.name ?? ""} · {formatter.format(new Date(event.start_at))}
              {event.end_at ? <> → {formatter.format(new Date(event.end_at))}</> : <> → <span className="italic">end time TBC</span></>}
            </CardDescription>
          </div>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <div className="flex flex-col gap-1 text-xs text-subtle lg:items-end">
              <span>
                <span className="font-semibold text-[var(--color-text)]">Assignee:</span> {currentAssigneeName}
              </span>
              <span>
                <span className="font-semibold text-[var(--color-text)]">Created by:</span>{" "}
                {event.created_by === user.id ? "You" : resolveUserName(event.created_by)}
              </span>
              {event.manager_responsible_id ? (
                <span>
                  <span className="font-semibold text-[var(--color-text)]">Manager responsible:</span>{" "}
                  {resolveUserName(event.manager_responsible_id)}
                </span>
              ) : null}
            </div>
            {(user.role === "administrator" ||
              (user.role === "office_worker" && event.venue_id === user.venueId)) ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/events/${event.id}/bookings`}>Bookings</Link>
              </Button>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      {/* Edit mode — EventForm owns the two-column grid */}
      {canEdit ? (
        <EventForm
          mode="edit"
          defaultValues={event}
          venues={venues}
          artists={artists}
          eventTypes={eventTypes.map((type) => type.label)}
          role={user.role}
          userVenueId={user.venueId}
          users={assignableUsers.map((u) => ({ id: u.id, name: u.name }))}
          sidebar={
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Save & submit</CardTitle>
                  <CardDescription>Save a draft first, then submit for review when ready.</CardDescription>
                </CardHeader>
                <CardContent>
                  <EventFormActions eventId={event.id} canDelete={canDelete} />
                  {canRevertToDraft ? (
                    <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                      <RevertToDraftButton eventId={event.id} />
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <EventDetailSummary event={event} />

              <BookingSettingsCard
                eventId={event.id}
                bookingEnabled={Boolean(event.booking_enabled)}
                totalCapacity={event.total_capacity ?? null}
                maxTicketsPerBooking={event.max_tickets_per_booking ?? 10}
                seoSlug={event.seo_slug ?? null}
                smsPromoEnabled={Boolean(event.sms_promo_enabled)}
                userRole={user.role}
              />

              {sopChecklistCard}
              <AttachmentsPanel
                parentType="event"
                parentId={event.id}
                attachments={attachments}
                canUpload={canUploadAttachments}
                viewerId={user.id}
                isAdmin={user.role === "administrator"}
                description="Files attached to this event or any of its planning tasks."
              />
              {reviewDecisionCard}
              {assignmentCard}
              {reviewerTimelineCard}
              {auditTrailCard}
              {debriefSubmitCard}
              {debriefSnapshotCard}
            </div>
          }
        />
      ) : (
        /* Read-only / non-editable layout */
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
          <div className="space-y-6">
            {canPreReview ? (
              <ProposalDecisionCard eventId={event.id} eventTitle={event.title} />
            ) : null}
            <EventDetailSummary event={event} />

            {debriefSubmitCard}
            {debriefSnapshotCard}
            {sopChecklistCard}
            <AttachmentsPanel
              parentType="event"
              parentId={event.id}
              attachments={attachments}
              canUpload={canUploadAttachments}
              viewerId={user.id}
              isAdmin={user.role === "administrator"}
              description="Files attached to this event or any of its planning tasks."
            />

            {canRevertToDraft ? (
              <Card>
                <CardHeader>
                  <CardTitle>Revert to draft</CardTitle>
                  <CardDescription>Pull this event back to draft for further changes.</CardDescription>
                </CardHeader>
                <CardContent>
                  <RevertToDraftButton eventId={event.id} />
                </CardContent>
              </Card>
            ) : null}

            {!canEdit && canDelete ? (
              <Card className="border-red-100 bg-red-50/50">
                <CardHeader>
                  <CardTitle className="text-red-700">Danger zone</CardTitle>
                  <CardDescription>Irreversible actions for this event.</CardDescription>
                </CardHeader>
                <CardContent>
                  <DeleteEventButton eventId={event.id} />
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="space-y-6">
            {reviewDecisionCard}
            {assignmentCard}
            {reviewerTimelineCard}
            {auditTrailCard}
          </div>
        </div>
      )}
    </div>
  );
}
