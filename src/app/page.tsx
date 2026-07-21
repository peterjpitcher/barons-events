import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  listEventsForUser,
  getStatusCounts,
  findConflicts,
} from "@/lib/events";
import {
  getDashboardTodoItems,
  getDebriefsDue,
  getDashboardOperationsSnapshot,
  getRecentActivity,
} from "@/lib/dashboard";
import { findNoteClashes } from "@/lib/calendar-notes";
import { UnifiedTodoList } from "@/components/todos/unified-todo-list";
import { UpcomingEventsCard } from "@/components/dashboard/context-cards/upcoming-events-card";
import { PipelineCard } from "@/components/dashboard/context-cards/pipeline-card";
import { ConflictsCard } from "@/components/dashboard/context-cards/conflicts-card";
import { DebriefsOutstandingCard } from "@/components/dashboard/context-cards/debriefs-outstanding-card";
import { RecentActivityCard } from "@/components/dashboard/context-cards/recent-activity-card";
import { EventReadinessCard } from "@/components/dashboard/context-cards/event-readiness-card";
import { BookingPulseCard } from "@/components/dashboard/context-cards/booking-pulse-card";
import {
  NeedsAttentionCard,
  type DashboardAttentionItem,
} from "@/components/dashboard/context-cards/needs-attention-card";
import { londonDateString } from "@/lib/planning/utils";
import { PageHeader } from "@/components/ui/design-primitives";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const roleCopy: Record<string, { heading: string; body: string }> = {
  administrator: {
    heading: "Command Centre",
    body: "Your personal overview of tasks, pipeline status, and upcoming events.",
  },
  manager: {
    heading: "Your Dashboard",
    body: "Stay on top of your tasks, submissions, and upcoming plans.",
  },
};

/** Safely resolve a promise, returning null on failure. */
async function safeFetch<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

function buildAttentionItems(params: {
  overdueCount: number;
  dueSoonCount: number;
  statusCounts: Record<string, number> | null;
  conflicts: Awaited<ReturnType<typeof findConflicts>> | null;
  debriefsDue: Awaited<ReturnType<typeof getDebriefsDue>> | null;
  operationsSnapshot: Awaited<ReturnType<typeof getDashboardOperationsSnapshot>> | null;
}): DashboardAttentionItem[] {
  const items: Array<DashboardAttentionItem & { priority: number }> = [];

  if (params.conflicts && params.conflicts.length > 0) {
    items.push({
      id: "conflicts",
      title: `${params.conflicts.length} event conflict${params.conflicts.length === 1 ? "" : "s"}`,
      subtitle: "Overlapping venue spaces need resolving.",
      href: `/events/${params.conflicts[0].event.id}`,
      label: "Conflict",
      tone: "danger",
      priority: 10,
    });
  }

  if (params.overdueCount > 0) {
    items.push({
      id: "overdue-todos",
      title: `${params.overdueCount} overdue todo${params.overdueCount === 1 ? "" : "s"}`,
      subtitle: "Assigned planning, SOP, review, revision, or debrief work is past due.",
      href: "/planning",
      label: "Overdue",
      tone: "danger",
      priority: 20,
    });
  }

  const pendingProposals = params.statusCounts?.pending_approval ?? 0;
  if (pendingProposals > 0) {
    items.push({
      id: "pending-proposals",
      title: `${pendingProposals} proposal${pendingProposals === 1 ? "" : "s"} awaiting approval`,
      subtitle: "Approve, reject, or request more detail from event proposers.",
      href: "/events/pending",
      label: "Approval",
      tone: "warning",
      priority: 30,
    });
  }

  const reviewQueue = (params.statusCounts?.submitted ?? 0) + (params.statusCounts?.needs_revisions ?? 0);
  if (reviewQueue > 0) {
    items.push({
      id: "review-queue",
      title: `${reviewQueue} event${reviewQueue === 1 ? "" : "s"} in review flow`,
      subtitle: "Submitted or revision-stage events are waiting on a decision.",
      href: "/reviews",
      label: "Review",
      tone: "warning",
      priority: 40,
    });
  }

  const detailsNeeded = params.statusCounts?.approved_pending_details ?? 0;
  if (detailsNeeded > 0) {
    items.push({
      id: "approved-pending-details",
      title: `${detailsNeeded} approved event${detailsNeeded === 1 ? "" : "s"} need details`,
      subtitle: "Approved proposals still need full event setup before publishing.",
      href: "/events",
      label: "Details",
      tone: "warning",
      priority: 45,
    });
  }

  for (const event of params.operationsSnapshot?.readiness ?? []) {
    if (event.readinessScore >= 75 && event.overdueTasks === 0 && event.blockedTasks === 0) continue;
    const firstIssue = event.issues[0]?.label ?? "Readiness risk";
    items.push({
      id: `readiness-${event.id}`,
      title: event.title,
      subtitle: `${event.dateLabel} at ${event.venueName}: ${firstIssue}`,
      href: event.href,
      label: `${event.readinessScore}%`,
      tone: event.readinessTone,
      priority: event.overdueTasks > 0 || event.blockedTasks > 0 ? 50 : 60,
    });
  }

  for (const alert of params.operationsSnapshot?.bookingPulse.capacityAlerts ?? []) {
    items.push({
      id: `capacity-${alert.id}`,
      title: alert.title,
      subtitle: `${alert.venueName}: ${alert.label.toLowerCase()} at ${alert.capacityPercent}% capacity.`,
      href: alert.href,
      label: "Capacity",
      tone: alert.tone,
      priority: 70,
    });
  }

  if (params.debriefsDue && params.debriefsDue.length > 0) {
    items.push({
      id: "debriefs-due",
      title: `${params.debriefsDue.length} outstanding debrief${params.debriefsDue.length === 1 ? "" : "s"}`,
      subtitle: "Past approved events are missing debrief submissions.",
      href: `/debriefs/${params.debriefsDue[0].id}`,
      label: "Debrief",
      tone: "warning",
      priority: 80,
    });
  }

  if (params.dueSoonCount > 0) {
    items.push({
      id: "due-soon-todos",
      title: `${params.dueSoonCount} todo${params.dueSoonCount === 1 ? "" : "s"} due soon`,
      subtitle: "Assigned work is due within the next seven days.",
      href: "/planning",
      label: "Soon",
      tone: "info",
      priority: 90,
    });
  }

  return items
    .sort((left, right) => left.priority - right.priority)
    .map(({ priority: _priority, ...item }) => item);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function OverviewPage(): Promise<React.ReactNode> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const copy = roleCopy[user.role] ?? roleCopy.administrator;
  const today = londonDateString();

  // Fetch todo items (all roles)
  const todoResult = await safeFetch(getDashboardTodoItems(user, today));

  // Fetch upcoming events (all roles)
  const allEvents = await safeFetch(listEventsForUser(user));
  const upcomingEvents = allEvents
    ? allEvents
        .filter((event) => new Date(event.start_at) >= new Date())
        .sort(
          (a, b) =>
            new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
        )
        .slice(0, 4)
    : null;
  const operationsSnapshot = allEvents
    ? await safeFetch(getDashboardOperationsSnapshot(allEvents, today))
    : null;

  // Role-specific additional fetches
  let statusCounts: Record<string, number> | null = null;
  let conflicts: Awaited<ReturnType<typeof findConflicts>> | null = null;
  let debriefsDue: Awaited<ReturnType<typeof getDebriefsDue>> | null = null;
  let recentActivity: Awaited<ReturnType<typeof getRecentActivity>> | null =
    null;
  let noteClashes: Awaited<ReturnType<typeof findNoteClashes>> | null = null;

  if (user.role === "administrator") {
    const [sc, cf, dd, ra, nc] = await Promise.all([
      safeFetch(getStatusCounts()),
      safeFetch(findConflicts()),
      safeFetch(getDebriefsDue(user)),
      safeFetch(getRecentActivity()),
      safeFetch(findNoteClashes({ all: true })),
    ]);
    statusCounts = sc;
    conflicts = cf;
    debriefsDue = dd;
    recentActivity = ra;
    noteClashes = nc;
  } else if (user.role === "manager" && user.venueId) {
    noteClashes = await safeFetch(findNoteClashes({ venueId: user.venueId }));
  }

  // Compute alert badge counts
  const overdueCount =
    todoResult?.items.filter((i) => i.urgency === "overdue").length ?? 0;
  const dueSoonCount =
    todoResult?.items.filter((i) => i.urgency === "due_soon").length ?? 0;
  const attentionItems = buildAttentionItems({
    overdueCount,
    dueSoonCount,
    statusCounts,
    conflicts,
    debriefsDue,
    operationsSnapshot,
  });

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Today"
        title={copy.heading}
        description={copy.body}
        actions={
          <div className="flex items-center gap-2">
          {overdueCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--burgundy-tint)] px-3 py-1 font-brand-mono text-[0.625rem] font-semibold uppercase tracking-[0.04em] text-[var(--burgundy)]">
              {overdueCount} overdue
            </span>
          )}
          {dueSoonCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--mustard-tint)] px-3 py-1 font-brand-mono text-[0.625rem] font-semibold uppercase tracking-[0.04em] text-[var(--mustard-dark)]">
              {dueSoonCount} due soon
            </span>
          )}
          </div>
        }
      />

      <div className="space-y-4 md:hidden">
        <NeedsAttentionCard items={attentionItems} />
        <UnifiedTodoList
          mode="dashboard"
          items={todoResult?.items ?? []}
          currentUserId={user.id}
          failedSources={todoResult?.errors}
        />
        {user.role === "administrator" ? <PipelineCard counts={statusCounts} /> : null}
        <BookingPulseCard pulse={operationsSnapshot?.bookingPulse ?? null} />
        <EventReadinessCard events={operationsSnapshot?.readiness ?? null} />
        {user.role === "administrator" ? (
          <>
            <ConflictsCard conflicts={conflicts} noteClashes={noteClashes} />
            <DebriefsOutstandingCard debriefs={debriefsDue} />
            <RecentActivityCard activity={recentActivity} />
          </>
        ) : null}
        {user.role === "manager" ? (
          <>
            {user.venueId ? (
              <ConflictsCard conflicts={[]} noteClashes={noteClashes} />
            ) : null}
            <UpcomingEventsCard
              events={upcomingEvents}
              userRole={user.role}
            />
          </>
        ) : null}
      </div>

      <div className="hidden gap-6 md:grid xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.85fr)]">
        <div className="space-y-4">
          <NeedsAttentionCard items={attentionItems} />
          <UnifiedTodoList
            mode="dashboard"
            items={todoResult?.items ?? []}
            currentUserId={user.id}
            failedSources={todoResult?.errors}
          />
          <EventReadinessCard events={operationsSnapshot?.readiness ?? null} />
        </div>

        <div className="space-y-4">
          {user.role === "administrator" && (
            <>
              <BookingPulseCard pulse={operationsSnapshot?.bookingPulse ?? null} />
              <PipelineCard counts={statusCounts} />
              <ConflictsCard conflicts={conflicts} noteClashes={noteClashes} />
              <DebriefsOutstandingCard debriefs={debriefsDue} />
              <RecentActivityCard activity={recentActivity} />
            </>
          )}

          {user.role === "manager" && (
            <>
              <BookingPulseCard pulse={operationsSnapshot?.bookingPulse ?? null} />
              {user.venueId ? (
                <ConflictsCard conflicts={[]} noteClashes={noteClashes} />
              ) : null}
              <UpcomingEventsCard
                events={upcomingEvents}
                userRole={user.role}
              />
            </>
          )}

        </div>
      </div>
    </div>
  );
}
