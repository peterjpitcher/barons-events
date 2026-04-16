import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  listEventsForUser,
  getStatusCounts,
  listReviewQueue,
  findConflicts,
} from "@/lib/events";
import {
  getDashboardTodoItems,
  getDebriefsDue,
  getExecutiveSummaryStats,
  getRecentActivity,
} from "@/lib/dashboard";
import { UnifiedTodoList } from "@/components/todos/unified-todo-list";
import { UpcomingEventsCard } from "@/components/dashboard/context-cards/upcoming-events-card";
import { PipelineCard } from "@/components/dashboard/context-cards/pipeline-card";
import { ConflictsCard } from "@/components/dashboard/context-cards/conflicts-card";
import { DebriefsOutstandingCard } from "@/components/dashboard/context-cards/debriefs-outstanding-card";
import { SummaryStatsCard } from "@/components/dashboard/context-cards/summary-stats-card";
import { RecentActivityCard } from "@/components/dashboard/context-cards/recent-activity-card";
import { londonDateString } from "@/lib/planning/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const roleCopy: Record<string, { heading: string; body: string }> = {
  administrator: {
    heading: "Command Centre",
    body: "Your personal overview of tasks, pipeline status, and upcoming events.",
  },
  office_worker: {
    heading: "Your Dashboard",
    body: "Stay on top of your tasks, submissions, and upcoming plans.",
  },
  executive: {
    heading: "Executive Snapshot",
    body: "Track event totals, activity, and key updates at a glance.",
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

  // Role-specific additional fetches
  let statusCounts: Record<string, number> | null = null;
  let conflicts: Awaited<ReturnType<typeof findConflicts>> | null = null;
  let debriefsDue: Awaited<ReturnType<typeof getDebriefsDue>> | null = null;
  let summaryStats: Awaited<ReturnType<typeof getExecutiveSummaryStats>> | null =
    null;
  let recentActivity: Awaited<ReturnType<typeof getRecentActivity>> | null =
    null;

  if (user.role === "administrator") {
    const [sc, cf, dd] = await Promise.all([
      safeFetch(getStatusCounts()),
      safeFetch(findConflicts()),
      safeFetch(getDebriefsDue(user)),
    ]);
    statusCounts = sc;
    conflicts = cf;
    debriefsDue = dd;
  } else if (user.role === "executive") {
    const [ss, ra] = await Promise.all([
      safeFetch(getExecutiveSummaryStats()),
      safeFetch(getRecentActivity()),
    ]);
    summaryStats = ss;
    recentActivity = ra;
  }

  // Compute alert badge counts
  const overdueCount =
    todoResult?.items.filter((i) => i.urgency === "overdue").length ?? 0;
  const dueSoonCount =
    todoResult?.items.filter((i) => i.urgency === "due_soon").length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-brand-serif text-3xl text-[var(--color-primary-700)]">
            {copy.heading}
          </h1>
          <p className="mt-1 max-w-2xl text-base text-subtle">{copy.body}</p>
        </div>
        <div className="flex items-center gap-3">
          {overdueCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(141,68,70,0.12)] px-3 py-1 text-xs font-semibold text-[var(--color-antique-burgundy)]">
              <span aria-hidden="true">&#9650;</span> {overdueCount} overdue
            </span>
          )}
          {dueSoonCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(194,149,76,0.15)] px-3 py-1 text-xs font-semibold text-[var(--color-warm-gold-700,#8B6914)]">
              <span aria-hidden="true">&#9679;</span> {dueSoonCount} due soon
            </span>
          )}
        </div>
      </div>

      {/* 60/40 grid */}
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        {/* Left column — Todo list */}
        <div>
          <UnifiedTodoList
            mode="dashboard"
            items={todoResult?.items ?? []}
            currentUserId={user.id}
            failedSources={todoResult?.errors}
          />
        </div>

        {/* Right column — Context cards */}
        <div className="space-y-4">
          {user.role === "administrator" && (
            <>
              <UpcomingEventsCard
                events={upcomingEvents}
                userRole={user.role}
                hasVenue={Boolean(user.venueId)}
              />
              <PipelineCard counts={statusCounts} />
              <ConflictsCard conflicts={conflicts} />
              <DebriefsOutstandingCard debriefs={debriefsDue} />
            </>
          )}

          {user.role === "office_worker" && (
            <UpcomingEventsCard
              events={upcomingEvents}
              userRole={user.role}
              hasVenue={Boolean(user.venueId)}
            />
          )}

          {user.role === "executive" && (
            <>
              <SummaryStatsCard stats={summaryStats} />
              <RecentActivityCard activity={recentActivity} />
              <UpcomingEventsCard
                events={upcomingEvents}
                userRole={user.role}
                hasVenue={Boolean(user.venueId)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
