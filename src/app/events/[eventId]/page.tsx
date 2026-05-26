import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventForm } from "@/components/events/event-form";
import { BookingSettingsCard } from "@/components/events/booking-settings-card";
import { EventPageHeader } from "@/components/events/event-page-header";
import { SopDrawer } from "@/components/events/sop-drawer";
import { DecisionForm } from "@/components/reviews/decision-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { canViewBookings, canViewPlanning } from "@/lib/roles";
import { canEditEventFromRow } from "@/lib/events/edit-context";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";
import { ProposalDecisionCard } from "@/components/events/proposal-decision-card";
import { listEventAttachmentsRollup } from "@/lib/attachments";
import { isLinkedToVenue } from "@/lib/visibility";
import type { EventStatus } from "@/lib/types";
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

const auditTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London"
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

  const event = await getEventDetail(eventId, user);
  if (!event) {
    notFound();
  }

  // Venue-scoped permission: office_worker can act on events at their venue (not just events they created)
  const isVenueScoped =
    user.role === "office_worker" &&
    user.venueId != null &&
    isLinkedToVenue({ venue_id: event.venue_id, venues: event.venues }, user.venueId);

  // Shared row projection for edit-context gating. All six fields come from
  // getEventDetail (SELECT *) so no widening is required.
  const eventRowForEdit = {
    id: event.id,
    venue_id: event.venue_id,
    manager_responsible_id: event.manager_responsible_id,
    created_by: event.created_by,
    status: event.status,
    deleted_at: event.deleted_at
  };

  // Edit / delete / booking-settings gate — defence-in-depth against the same
  // rules enforced by RLS and the status-transition trigger. The matching
  // server actions all use canEditEvent (see plan Task 9/10/16); keeping the
  // UI aligned avoids dead controls that would server-reject.
  const canEdit = canEditEventFromRow(user, eventRowForEdit);
  const canDelete = canEditEventFromRow(user, eventRowForEdit);
  const canRevertToDraft =
    canEdit && user.role === "administrator" &&
    ["submitted", "needs_revisions", "approved", "rejected"].includes(event.status);
  const canViewEventBookings = canViewBookings(user.role);

  const canReview =
    (user.role === "administrator" && ["submitted", "needs_revisions"].includes(event.status));
  const canPreReview =
    user.role === "administrator" && event.status === "pending_approval";
  const canSubmitDebrief =
    (isVenueScoped && ["approved", "completed"].includes(event.status)) ||
    (user.role === "administrator" && ["approved", "completed"].includes(event.status));
  const canUpdateAssignee = user.role === "administrator";

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

  // SEC-005 follow-up: attachment upload follows the unified event-edit rule,
  // not the legacy same-venue check. Non-manager OWs at the same venue no
  // longer see upload controls for events they can't edit.
  const canUploadAttachments = canEditEventFromRow(user, eventRowForEdit);

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
          manuallyAssigned: (task as any).manually_assigned ?? false,
          dependsOnTaskIds: Array.isArray(task?.dependencies)
            ? task.dependencies.map((d: RawDep) => d.depends_on_task_id).filter(Boolean)
            : [],
          notes: task.notes ?? null,
          // Event page doesn't lazy-load per-task attachments here; the
          // detail page roll-up covers that surface. See issue-log 04.
          attachments: [],
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
      <CardHeader className="border-b border-[var(--hair)] bg-[var(--paper-tint)] px-4 py-3">
        <CardTitle className="font-brand-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">Assignment</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted">Send the next action to the right teammate.</p>
        {canUpdateAssignee ? (
          <form className="space-y-3 text-sm" action={reassignAssignee}>
            <div className="space-y-2">
              <label htmlFor="assigneeId" className="font-semibold text-[var(--ink)]">
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
            <span className="font-semibold text-[var(--ink)]">Assignee:</span> {currentAssigneeName}
          </p>
        )}
      </CardContent>
    </Card>
  );

  const reviewDecisionCard = canReview ? (
    <Card>
      <CardHeader className="border-b border-[var(--hair)] bg-[var(--paper-tint)] px-4 py-3">
        <CardTitle className="font-brand-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">Review decision</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted">Share a clear decision so the venue knows what to do next.</p>
        <DecisionForm eventId={event.id} />
      </CardContent>
    </Card>
  ) : null;

  const reviewerTimelineCard = (
    <Card>
      <CardHeader className="border-b border-[var(--hair)] bg-[var(--paper-tint)] px-4 py-3">
        <CardTitle className="font-brand-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">Reviewer timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted">Quick view of submissions and reviewer notes.</p>
        {event.approvals.length === 0 ? (
          <p className="text-sm text-subtle">No reviewer decisions recorded yet.</p>
        ) : (
          event.approvals.map((entry) => (
            <div
              key={entry.id}
              className="rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] px-4 py-3 text-sm shadow-card"
            >
              <p className="font-semibold text-[var(--ink)] capitalize">{entry.decision.replace(/_/g, " ")}</p>
              <p className="text-xs text-subtle">
                {resolveUserName(entry.reviewer_id)} · {new Date(entry.decided_at).toLocaleString("en-GB")}
              </p>
              {entry.feedback_text ? (
                <p className="mt-2 text-[var(--ink)]">{entry.feedback_text}</p>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );

  const auditTrailCard = (
    <Card>
      <CardHeader className="border-b border-[var(--hair)] bg-[var(--paper-tint)] px-4 py-3">
        <CardTitle className="font-brand-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">Audit trail</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted">Track status changes, assignments, and reviewer feedback.</p>
        {auditEntries.length === 0 ? (
          <p className="text-sm text-subtle">No activity recorded yet.</p>
        ) : (
          auditEntries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)] shadow-card"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-[var(--ink)]">{entry.summary}</p>
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
                        className="mt-[0.35rem] h-1.5 w-1.5 flex-none rounded-full bg-[var(--slate)]"
                        aria-hidden="true"
                      />
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {entry.feedback ? (
                <p className="mt-3 rounded-[var(--radius)] bg-[var(--paper-tint)] p-3 text-sm leading-relaxed text-[var(--ink)]">
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
      <CardHeader className="border-b border-[var(--hair)] bg-[var(--paper-tint)] px-4 py-3">
        <CardTitle className="font-brand-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">Post-event debrief</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted">Capture attendance and takings as soon as possible.</p>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
        </div>
      </CardContent>
    </Card>
  ) : null;

  const debriefSnapshotCard = event.debrief ? (
    <Card>
      <CardHeader className="border-b border-[var(--hair)] bg-[var(--paper-tint)] px-4 py-3">
        <CardTitle className="font-brand-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">Debrief snapshot</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted">Commercial outcome and guest sentiment for this event.</p>
        <div className="grid gap-3 text-sm text-muted md:grid-cols-2">
        <p>
          <span className="font-semibold text-[var(--ink)]">Attendance:</span>{" "}
          {event.debrief.attendance ?? "—"}
          {event.debrief.baseline_attendance != null
            ? ` (baseline ${event.debrief.baseline_attendance})`
            : ""}
        </p>
        <p>
          <span className="font-semibold text-[var(--ink)]">Event takings:</span>{" "}
          {formatCurrency(event.debrief.actual_total_takings)}
        </p>
        <p>
          <span className="font-semibold text-[var(--ink)]">Baseline takings:</span>{" "}
          {formatCurrency(event.debrief.baseline_total_takings)}
        </p>
        <p>
          <span className="font-semibold text-[var(--ink)]">Sales uplift:</span>{" "}
          {formatCurrency(event.debrief.sales_uplift_value)} ({formatPercent(event.debrief.sales_uplift_percent)})
        </p>
        <p>
          <span className="font-semibold text-[var(--ink)]">Would book again:</span>{" "}
          {event.debrief.would_book_again == null ? "Not answered" : event.debrief.would_book_again ? "Yes" : "No"}
        </p>
        <p>
          <span className="font-semibold text-[var(--ink)]">Promo score:</span>{" "}
          {event.debrief.promo_effectiveness ?? "—"} / 5
        </p>
        {event.debrief.guest_sentiment_notes ? (
          <p className="md:col-span-2">
            <span className="font-semibold text-[var(--ink)]">Guest sentiment:</span>{" "}
            {event.debrief.guest_sentiment_notes}
          </p>
        ) : null}
        {event.debrief.next_time_actions ? (
          <p className="md:col-span-2">
            <span className="font-semibold text-[var(--ink)]">Next time actions:</span>{" "}
            {event.debrief.next_time_actions}
          </p>
        ) : null}
        </div>
      </CardContent>
    </Card>
  ) : null;

  return (
    <div className={canEdit ? "app-page pb-32" : "app-page"}>
      <EventPageHeader
        title={event.title}
        mode={canEdit ? "edit" : "view"}
        status={event.status as EventStatus}
        eventId={event.id}
        canDelete={canDelete}
        canRevertToDraft={canRevertToDraft}
      />

      {/* Quick info bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle">
        <span>
          <span className="font-semibold text-[var(--ink)]">Assignee:</span> {currentAssigneeName}
        </span>
        <span>
          <span className="font-semibold text-[var(--ink)]">Created by:</span>{" "}
          {event.created_by === user.id ? "You" : resolveUserName(event.created_by)}
        </span>
        {event.manager_responsible_id ? (
          <span>
            <span className="font-semibold text-[var(--ink)]">Manager:</span>{" "}
            {resolveUserName(event.manager_responsible_id)}
          </span>
        ) : null}
        {canViewEventBookings ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={`/events/${event.id}/bookings`}>Bookings</Link>
          </Button>
        ) : null}
      </div>

      {/* EventForm for all users — read-only for non-editors */}
      <EventForm
        key={event.id}
        mode="edit"
        defaultValues={event}
        venues={venues}
        artists={artists}
        eventTypes={eventTypes.map((type) => type.label)}
        role={user.role}
        userVenueId={user.venueId}
        users={assignableUsers.map((u) => ({ id: u.id, name: u.name }))}
        canDelete={canDelete}
        readOnly={!canEdit}
        debrief={event.debrief}
      />

      {/* Lower cards grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {canEdit ? (
          <BookingSettingsCard
            eventId={event.id}
            bookingEnabled={Boolean(event.booking_enabled)}
            totalCapacity={event.total_capacity ?? null}
            maxTicketsPerBooking={event.max_tickets_per_booking ?? 10}
            bookingNotesEnabled={Boolean(event.booking_notes_enabled)}
            seoSlug={event.seo_slug ?? null}
            smsPromoEnabled={Boolean(event.sms_promo_enabled)}
            bookingUrl={event.booking_url ?? null}
            bookingType={event.booking_type ?? null}
            userRole={user.role}
          />
        ) : null}

        <AttachmentsPanel
          parentType="event"
          parentId={event.id}
          attachments={attachments}
          canUpload={canUploadAttachments}
          viewerId={user.id}
          isAdmin={user.role === "administrator"}
          description="Files attached to this event or any of its planning tasks."
        />
        {canPreReview ? (
          <ProposalDecisionCard eventId={event.id} eventTitle={event.title} />
        ) : null}
        {reviewDecisionCard}
        {assignmentCard}
        {reviewerTimelineCard}
        {auditTrailCard}
        {debriefSubmitCard}
        {debriefSnapshotCard}
      </div>

      {sopPlanningItemId && sopTasks.length > 0 ? (
        <SopDrawer
          tasks={sopTasks}
          users={assignableUsers.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))}
          itemId={sopPlanningItemId}
          currentUserId={user.id}
          readOnly={!canEdit}
        />
      ) : null}
    </div>
  );
}
