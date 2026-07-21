import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { CalendarDays, Clock, Edit, MapPin, Share2 } from "lucide-react";
import { EventForm } from "@/components/events/event-form";
import { BookingSettingsCard } from "@/components/events/booking-settings-card";
import { EventPageHeader } from "@/components/events/event-page-header";
import { SopDrawer } from "@/components/events/sop-drawer";
import { DecisionForm } from "@/components/reviews/decision-form";
import { AuditTrailPanel } from "@/components/audit/audit-trail-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { getEventDetail } from "@/lib/events";
import { EVENT_GOALS_BY_VALUE, humanizeGoalValue, parseGoalFocus } from "@/lib/event-goals";
import { listVenues } from "@/lib/venues";
import { listEventTypes } from "@/lib/event-types";
import { listArtists } from "@/lib/artists";
import { listAssignableUsers, getUsersByIds } from "@/lib/users";
import { parseVenueSpaces } from "@/lib/venue-spaces";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canSubmitDebriefForEvent, canViewBookings, canViewPlanning } from "@/lib/roles";
import { canEditEventFromRow } from "@/lib/events/edit-context";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";
import { ProposalDecisionCard } from "@/components/events/proposal-decision-card";
import { listEventAttachmentsRollup } from "@/lib/attachments";
import { InternalNotesPanel } from "@/components/internal-notes/internal-notes-panel";
import { listInternalNotes } from "@/lib/internal-notes";
import { listCalendarNotes } from "@/lib/calendar-notes";
import type { EventStatus } from "@/lib/types";
import type { PlanningTask, PlanningTaskStatus } from "@/lib/planning/types";

const statusCopy: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending_approval: { label: "Proposal — awaiting approval", tone: "info" },
  approved_pending_details: { label: "Approved — add details", tone: "info" },
  submitted: { label: "Waiting review", tone: "info" },
  needs_revisions: { label: "Needs tweaks", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "danger" },
  completed: { label: "Completed", tone: "success" }
};

const eventDateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Europe/London"
});

function buildEventImageUrl(path: string | null | undefined): string | null {
  if (!path || !path.trim().length) return null;
  const base =
    typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string"
      ? process.env.NEXT_PUBLIC_SUPABASE_URL.trim().replace(/\/+$/g, "")
      : "";
  if (!base.length) return null;
  return `${base}/storage/v1/object/public/event-images/${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

type EventSopData = {
  tasks: PlanningTask[];
  planningItemId: string | null;
};

async function loadEventSopData(eventId: string, canViewEventPlanning: boolean): Promise<EventSopData> {
  if (!canViewEventPlanning) {
    return { tasks: [], planningItemId: null };
  }

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

  if (!planningItem) {
    return { tasks: [], planningItemId: null };
  }

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
    manually_assigned?: boolean;
    notes: string | null;
    assignee: RawUser | RawUser[] | null;
    assignees: RawAssigneeJunction[];
    dependencies: RawDep[];
  };

  const tasks = rawTasks.map((task: RawTask): PlanningTask => {
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
      manuallyAssigned: task.manually_assigned ?? false,
      dependsOnTaskIds: Array.isArray(task?.dependencies)
        ? task.dependencies.map((d: RawDep) => d.depends_on_task_id).filter(Boolean)
        : [],
      notes: task.notes ?? null,
      attachments: [],
    };
  });

  return { tasks, planningItemId: planningItem.id };
}

async function loadEventActorDirectory(actorIds: string[]): Promise<Record<string, { id: string; name: string; email: string }>> {
  try {
    return await getUsersByIds(actorIds);
  } catch (error) {
    console.error("Could not resolve actor names", error);
    return {};
  }
}

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
  const canReschedule =
    user.role === "administrator" &&
    event.status === "approved";
  const canViewEventBookings = canViewBookings(user.role);

  const canReview =
    (user.role === "administrator" && ["submitted", "needs_revisions"].includes(event.status));
  const canPreReview =
    user.role === "administrator" && event.status === "pending_approval";
  const canViewEventPlanning = canViewPlanning(user.role);
  const canSubmitDebrief = canSubmitDebriefForEvent(user.role, user.id, user.venueId, {
    venueId: event.venue_id,
    venueIds: event.venues.map((venue) => venue.id),
    managerResponsibleId: event.manager_responsible_id,
    createdBy: event.created_by,
    status: event.status,
    deletedAt: event.deleted_at
  });

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

  const [
    venues,
    assignableUsers,
    eventTypes,
    artists,
    attachments,
    internalNotes,
    userPrefsResult,
    sopData,
    userDirectory
  ] = await Promise.all([
    listVenues(),
    listAssignableUsers(),
    listEventTypes(),
    listArtists(),
    listEventAttachmentsRollup(event.id),
    listInternalNotes("event", event.id),
    createSupabaseAdminClient()
      .from("users")
      .select("sop_drawer_pinned, debrief_pinned")
      .eq("id", user.id)
      .maybeSingle(),
    loadEventSopData(eventId, canViewEventPlanning),
    loadEventActorDirectory(Array.from(actorIds))
  ]);
  const userPrefs = userPrefsResult.data;

  // Advisory clash warning data: a failed fetch must never block the form.
  const notesResult = await listCalendarNotes().catch(() => ({ notes: [], truncated: false, failed: true as const }));
  const clashNotes = notesResult.notes.map((n) => ({ id: n.id, venueId: n.venueId, title: n.title, startDate: n.startDate, endDate: n.endDate }));
  const notesUnavailable = "failed" in notesResult;

  // SEC-005 follow-up: attachment upload follows the unified event-edit rule,
  // not the legacy same-venue check. Non-manager OWs at the same venue no
  // longer see upload controls for events they can't edit.
  const canUploadAttachments = canEditEventFromRow(user, eventRowForEdit);

  const sopTasks = sopData.tasks;
  const sopPlanningItemId = sopData.planningItemId;

  const assignableDirectory = new Map(assignableUsers.map((person) => [person.id, person]));

  const resolveUserName = (id: string | null | undefined): string => {
    if (!id) {
      return "Unassigned";
    }
    return userDirectory[id]?.name ?? assignableDirectory.get(id)?.name ?? "Unknown user";
  };

  const mobileEventImageUrl = buildEventImageUrl(event.event_image_path);
  const mobileStatus = statusCopy[event.status] ?? statusCopy.draft;
  const mobileVenueNames = event.venues.length > 0
    ? event.venues.map((venue) => venue.name)
    : event.venue?.name
      ? [event.venue.name]
      : [];
  const mobileVenueLabel = mobileVenueNames.length > 1
    ? `${mobileVenueNames[0]} +${mobileVenueNames.length - 1}`
    : mobileVenueNames[0] ?? "Venue TBC";
  const mobileSpaces = parseVenueSpaces(event.venue_space);
  const mobileSpaceLabel = mobileSpaces.length ? mobileSpaces.join(", ") : "Space TBC";
  const mobileStart = new Date(event.start_at);
  const mobileEnd = event.end_at ? new Date(event.end_at) : null;
  const mobileDateLabel = eventDateFormatter.format(mobileStart);
  const mobileTimeLabel = `${mobileStart.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}${mobileEnd ? ` - ${mobileEnd.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}` : ""}`;

  // ─── Shared right-column cards ────────────────────────────────────────────

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

  const auditTrailFallback = (
    <Card>
      <CardHeader className="!rounded-t-[var(--radius-lg)] !bg-[var(--navy)] px-6 py-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider !text-white">Audit trail</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted">Loading audit trail...</p>
      </CardContent>
    </Card>
  );

  const auditTrailCard = (
    <Suspense fallback={auditTrailFallback}>
    <AuditTrailPanel
      entityType="event"
      entityId={event.id}
      description="Track status changes, assignments, and reviewer feedback."
    />
    </Suspense>
  );

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
      <div className="md:hidden">
        <div className="-mx-4 -mt-4">
          {mobileEventImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mobileEventImageUrl} alt={`${event.title} event image`} className="h-44 w-full object-cover" />
          ) : (
            <div className="flex h-44 w-full items-center justify-center bg-[var(--slate)] text-sm text-white/70">Event image</div>
          )}
        </div>
        <div className="-mt-8 mobile-card relative">
          <div className="mb-2 flex flex-wrap gap-2">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
              mobileStatus.tone === "danger"
                ? "bg-[var(--burgundy)] text-white"
                : mobileStatus.tone === "warning"
                  ? "bg-[var(--mustard)] text-[var(--ink-on-mustard)]"
                  : mobileStatus.tone === "success"
                    ? "bg-[var(--sage-dark)] text-white"
                    : "bg-[var(--slate)] text-white"
            }`}>
              {mobileStatus.label}
            </span>
            {event.booking_enabled ? (
              <span className="inline-flex rounded-full bg-[var(--canvas-2)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                Bookings on
              </span>
            ) : null}
          </div>
          <h1 className="font-brand-serif text-[23px] font-medium leading-tight text-[var(--navy)]">{event.title}</h1>
          <div className="mt-3 flex flex-col gap-1.5 text-sm text-[var(--ink-muted)]">
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              {mobileDateLabel}
            </span>
            <span className="inline-flex items-center gap-2">
              <Clock className="h-4 w-4" aria-hidden="true" />
              {mobileTimeLabel}
            </span>
            <span className="inline-flex items-center gap-2">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {mobileVenueLabel} · {mobileSpaceLabel}
            </span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-[11px] bg-[var(--canvas-2)] p-1">
          {["Details", "Bookings", "Tasks"].map((label, index) => (
            <Link
              key={label}
              href={index === 1 ? `/events/${event.id}/bookings` : index === 2 ? `#sop-drawer-trigger-${event.id}` : "#event-mobile-facts"}
              className={`inline-flex h-9 items-center justify-center rounded-[9px] text-xs font-semibold ${index === 0 ? "bg-[var(--paper)] text-[var(--navy)] shadow-card" : "text-[var(--ink-muted)]"}`}
            >
              {label}
            </Link>
          ))}
        </div>
        <section id="event-mobile-facts" className="mt-3 mobile-card">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ["Type", event.event_type ?? "TBC"],
              ["Venues", mobileVenueLabel],
              ["Space", mobileSpaceLabel],
              ["Headcount", event.expected_headcount != null ? String(event.expected_headcount) : "TBC"],
              ["Capacity", event.total_capacity != null ? String(event.total_capacity) : "TBC"],
              ["Bookings", event.booking_enabled ? "Enabled" : "Disabled"],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="mobile-eyebrow">{label}</p>
                <p className="mt-1 font-semibold text-[var(--ink)]">{value}</p>
              </div>
            ))}
          </div>
          {event.notes ? <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink-muted)]">{event.notes}</p> : null}
        </section>
        <div className="mt-3 flex gap-2">
          <a
            href={`mailto:?subject=${encodeURIComponent(event.title)}&body=${encodeURIComponent(event.title)}`}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[11px] border border-[var(--hair)] bg-[var(--paper)] px-4 text-sm font-semibold text-[var(--ink)]"
          >
            <Share2 className="h-4 w-4" aria-hidden="true" />
            Share
          </a>
          {canEdit ? (
            <a
              href="#event-form"
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[11px] bg-[var(--navy)] px-4 text-sm font-semibold text-white"
            >
              <Edit className="h-4 w-4" aria-hidden="true" />
              Edit event
            </a>
          ) : null}
        </div>
      </div>

      <div className="hidden md:block">
        <EventPageHeader
          title={event.title}
          mode={canEdit ? "edit" : "view"}
          status={event.status as EventStatus}
          eventId={event.id}
          canReschedule={canReschedule}
          canDelete={canDelete}
          canRevertToDraft={canRevertToDraft}
        />
      </div>

      {/* Quick info bar */}
      <div className="hidden flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle md:flex">
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
        {canReschedule ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={`/events/${event.id}/reschedule`}>Reschedule</Link>
          </Button>
        ) : null}
        {canViewEventPlanning ? (
          <Button id={`sop-drawer-trigger-${event.id}`} type="button" variant="secondary" size="sm" className="text-white hover:text-white">
            SOP
          </Button>
        ) : null}
      </div>

      {/* EventForm for all users — read-only for non-editors */}
      <div id="event-form">
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
          canSubmitDebrief={canSubmitDebrief}
          debriefInitiallyPinned={Boolean(userPrefs?.debrief_pinned)}
          reserveFloatingActionSpace={false}
          clashNotes={clashNotes}
          notesUnavailable={notesUnavailable}
        />
      </div>

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
        <InternalNotesPanel
          parentType="event"
          parentId={event.id}
          notes={internalNotes}
          canAdd={canEdit}
        />
        {canPreReview ? (
          <ProposalDecisionCard eventId={event.id} eventTitle={event.title} />
        ) : null}
        {reviewDecisionCard}
        {auditTrailCard}
        {debriefSnapshotCard}
      </div>

      {canViewEventPlanning ? (
        <SopDrawer
          tasks={sopTasks}
          users={assignableUsers.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))}
          itemId={sopPlanningItemId}
          currentUserId={user.id}
          readOnly={!canEdit}
          initiallyPinned={Boolean(userPrefs?.sop_drawer_pinned)}
          externalTriggerId={`sop-drawer-trigger-${event.id}`}
          title="ALL TODO ITEMS"
        />
      ) : null}
    </div>
  );
}
