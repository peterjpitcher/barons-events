"use client";

import { useMemo } from "react";
import useSWR from "swr";

type EventSummary = {
  id: string;
  title: string;
  status: string;
  startAt: string | null;
  venueName: string | null;
  venueSpace: string | null;
};

type CalendarEvent = {
  id: string;
  title: string;
  status: string;
  startAt: string;
  endAt: string;
  venueName: string | null;
  venueSpace: string | null;
  conflict: boolean;
  assignedReviewerId: string | null;
  assignedReviewerName: string | null;
};

type ReviewerSlaSnapshot = {
  reviewerId: string;
  reviewerName: string | null;
  totalAssigned: number;
  onTrack: number;
  warning: number;
  overdue: number;
  nextDueAt: string | null;
};

type PlanningAnalyticsResponse = {
  statusCounts: Record<string, number>;
  conflicts: Array<{
    key: string;
    venueName: string;
    venueSpace: string;
    first: EventSummary;
    second: EventSummary;
  }>;
  upcoming: EventSummary[];
  awaitingReviewer: EventSummary[];
  totalEvents: number;
  calendarEvents: CalendarEvent[];
  reviewerSla: ReviewerSlaSnapshot[];
};

type PlanningAnalyticsClientProps = {
  initialData: PlanningAnalyticsResponse;
};

const fetcher = async (url: string) => {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as PlanningAnalyticsResponse;
};

const formatDateTime = (value: string | null) => {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return date.toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  needs_revisions: "Needs revisions",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
  completed: "Completed",
};

export function PlanningAnalyticsClient({
  initialData,
}: PlanningAnalyticsClientProps) {
  const { data, error } = useSWR("/api/planning-feed", fetcher, {
    fallbackData: initialData,
    revalidateOnFocus: false,
  });

  const analytics = useMemo(() => data ?? initialData, [data, initialData]);

  const summaryCards = [
    {
      label: "Total events",
      value: analytics.totalEvents,
      tone: "text-black",
      detail: "All records across statuses",
    },
    {
      label: "Submitted",
      value: analytics.statusCounts.submitted ?? 0,
      tone: "text-amber-700",
      detail: "Awaiting reviewer decisions",
    },
    {
      label: "Needs revisions",
      value: analytics.statusCounts.needs_revisions ?? 0,
      tone: "text-rose-700",
      detail: "Returned to venue managers",
    },
    {
      label: "Approved",
      value: analytics.statusCounts.approved ?? 0,
      tone: "text-emerald-700",
      detail: "Ready for publishing hand-off",
    },
    {
      label: "Conflicts",
      value: analytics.conflicts.length,
      tone: "text-amber-900",
      detail: "Venue-space overlaps detected",
    },
  ];

  const awaitingPreview = analytics.awaitingReviewer.slice(0, 5);
  const conflictPreview = analytics.conflicts.slice(0, 8);
  const reviewerSlaPreview = analytics.reviewerSla.slice(0, 4);
  const calendarConflictCount = analytics.calendarEvents.filter((event) => event.conflict).length;
  const nextCalendarEvent = analytics.calendarEvents[0];

  if (analytics.totalEvents === 0) {
    return (
      <div className="rounded-xl border border-dashed border-black/20 bg-white px-4 py-6 text-sm text-black/70">
        No events found yet. Run <code>npm run supabase:reset</code> to load the seeded
        analytics dataset locally.
      </div>
    );
  }

  return (
    <>
      {error ? (
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Unable to refresh analytics from the API. Showing cached data.
        </div>
      ) : null}

      <div className="grid gap-3 rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm sm:grid-cols-5">
        {summaryCards.map((card) => (
          <div key={card.label} className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-black/50">
              {card.label}
            </span>
            <span className={`text-2xl font-semibold ${card.tone}`}>{card.value}</span>
            <span className="text-xs text-black/50">{card.detail}</span>
          </div>
        ))}
      </div>

      {analytics.awaitingReviewer.length > 0 ? (
        <div className="rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-black">
                Submitted without assigned reviewer
              </h2>
              <p className="text-sm text-black/70">
                Reassign or follow up on these submissions to keep the queue flowing.
              </p>
            </div>
            <span className="text-xs font-semibold uppercase tracking-wide text-black/50">
              {analytics.awaitingReviewer.length} item
              {analytics.awaitingReviewer.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="mt-4 space-y-3">
            {awaitingPreview.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-black/[0.06] bg-black/[0.015] px-3 py-2 text-sm text-black/80"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-black">{event.title}</span>
                  <span className="text-xs text-black/60">
                    {event.venueName ?? "Unknown venue"} · {event.venueSpace ?? "General space"}
                  </span>
                </div>
                <span className="text-xs text-black/60">{formatDateTime(event.startAt)}</span>
              </li>
            ))}
          </ul>
          {analytics.awaitingReviewer.length > awaitingPreview.length ? (
            <p className="mt-3 text-xs text-black/50">
              {analytics.awaitingReviewer.length - awaitingPreview.length} more submission
              {analytics.awaitingReviewer.length - awaitingPreview.length === 1 ? "" : "s"} awaiting reviewer coverage.
            </p>
          ) : null}
        </div>
      ) : null}

      {conflictPreview.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-semibold">Venue-space conflicts</span>
            <span className="text-xs uppercase tracking-wide text-amber-700">
              {analytics.conflicts.length} overlap{analytics.conflicts.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {conflictPreview.map((pair) => (
              <div
                key={pair.key}
                className="rounded-lg border border-amber-200 bg-white/70 px-3 py-2 text-sm text-amber-900"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{pair.venueName}</span>
                  <span className="text-xs text-amber-700">{pair.venueSpace}</span>
                </div>
                <span className="block text-xs text-amber-800">
                  {pair.first.title} ({formatDateTime(pair.first.startAt)}) overlaps with{" "}
                  {pair.second.title} ({formatDateTime(pair.second.startAt)})
                </span>
              </div>
            ))}
            {analytics.conflicts.length > conflictPreview.length ? (
              <div className="text-xs text-amber-700">
                {analytics.conflicts.length - conflictPreview.length} more potential conflict
                {analytics.conflicts.length - conflictPreview.length === 1 ? "" : "s"} not shown.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-black">Reviewer SLA trend</h2>
              <p className="text-sm text-black/70">
                Submitted events grouped by urgency to highlight where to intervene first.
              </p>
            </div>
            <span className="text-xs font-semibold uppercase tracking-wide text-black/50">
              {analytics.reviewerSla.length} reviewer
              {analytics.reviewerSla.length === 1 ? "" : "s"}
            </span>
          </div>
          {analytics.reviewerSla.length === 0 ? (
            <p className="mt-4 text-xs text-black/50">
              No submitted events currently assigned to reviewers.
            </p>
          ) : (
            <>
              <ul className="mt-4 space-y-3">
                {reviewerSlaPreview.map((snapshot) => (
                  <li
                    key={snapshot.reviewerId}
                    className="rounded-lg border border-black/[0.06] bg-black/[0.015] px-3 py-3 text-sm text-black/80"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-black">
                          {snapshot.reviewerName ?? "Unlabelled reviewer"}
                        </span>
                        <span className="text-xs text-black/60">
                          {snapshot.totalAssigned} submission
                          {snapshot.totalAssigned === 1 ? "" : "s"} assigned
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">
                          OK {snapshot.onTrack}
                        </span>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                          Warn {snapshot.warning}
                        </span>
                        <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">
                          Overdue {snapshot.overdue}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-black/60">
                      Next due:{" "}
                      {snapshot.nextDueAt ? formatDateTime(snapshot.nextDueAt) : "No scheduled date"}
                    </div>
                  </li>
                ))}
              </ul>
              {analytics.reviewerSla.length > reviewerSlaPreview.length ? (
                <p className="mt-3 text-xs text-black/50">
                  {analytics.reviewerSla.length - reviewerSlaPreview.length} additional reviewer
                  {analytics.reviewerSla.length - reviewerSlaPreview.length === 1 ? "" : "s"} not
                  shown.
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-black">Calendar feed</h2>
              <p className="text-sm text-black/70">
                Export upcoming events (with conflict flags) into your calendar tool of choice.
              </p>
            </div>
            <a
              href="/api/planning-feed/calendar"
              className="inline-flex items-center rounded-full border border-black/[0.12] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-black hover:bg-black hover:text-white"
            >
              Download ICS
            </a>
          </div>
          <dl className="mt-4 space-y-2 text-sm text-black/70">
            <div className="flex items-center justify-between">
              <dt>Events exported</dt>
              <dd className="font-medium text-black">{analytics.calendarEvents.length}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Conflicts highlighted</dt>
              <dd className="font-medium text-amber-800">{calendarConflictCount}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Next event</dt>
              <dd className="font-medium text-black">
                {nextCalendarEvent ? formatDateTime(nextCalendarEvent.startAt) : "—"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-black/50">
            The feed refreshes with every analytics run. Conflicted events include “Conflict” in the
            summary line so they stand out in calendar views.
          </p>
        </div>
      </div>

      {analytics.upcoming.length > 0 ? (
        <div className="rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-black">Upcoming events</h2>
              <p className="text-sm text-black/70">
                Sorted by start date to drive the planning calendar and weekly digest.
              </p>
            </div>
            <span className="text-xs font-semibold uppercase tracking-wide text-black/50">
              {analytics.upcoming.length} upcoming
            </span>
          </div>
          <ul className="mt-4 space-y-3">
            {analytics.upcoming.slice(0, 8).map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-black/[0.06] bg-black/[0.015] px-3 py-2 text-sm text-black/80"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-black">{event.title}</span>
                  <span className="text-xs text-black/60">
                    {event.venueName ?? "Unknown venue"} · {event.venueSpace ?? "General space"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs text-black/60">{formatDateTime(event.startAt)}</span>
                  <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-black/60">
                    {statusLabels[event.status] ?? event.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

export default PlanningAnalyticsClient;
