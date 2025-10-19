"use client";

import Link from "next/link";
import { useMemo } from "react";
import useSWR from "swr";
import { StatPill } from "@/components/ui/stat-pill";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type EventSummary = {
  id: string;
  title: string;
  status: string;
  startAt: string | null;
  venueName: string | null;
  venueSpace: string | null;
  areas?: Array<{ id: string; name: string | null; capacity: number | null }>;
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
  slaWarningQueued: number;
  metadata?: {
    calendarFeedUrl: string;
    generatedAt: string;
  };
};

type EventLinkOptions = {
  source?: string;
  hash?: string;
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

const statusBadgeVariants: Record<string, BadgeVariant> = {
  draft: "neutral",
  submitted: "info",
  needs_revisions: "warning",
  approved: "success",
  rejected: "danger",
  published: "success",
  completed: "success",
};

const getStatusBadgeVariant = (status: string): BadgeVariant =>
  statusBadgeVariants[status] ?? "neutral";

const buildEventHref = (eventId: string, options: EventLinkOptions = {}) => {
  const params = new URLSearchParams();

  if (options.source) {
    params.set("source", options.source);
  }

  const query = params.toString();
  const hash = options.hash ? `#${options.hash}` : "";
  const queryPrefix = query.length > 0 ? `?${query}` : "";

  return `/events/${eventId}${queryPrefix}${hash}`;
};

export function PlanningAnalyticsClient({
  initialData,
}: PlanningAnalyticsClientProps) {
  const { data, error } = useSWR("/api/planning-feed", fetcher, {
    fallbackData: initialData,
    revalidateOnFocus: false,
  });

  const analytics = useMemo(() => data ?? initialData, [data, initialData]);
  const totalEvents = analytics.totalEvents;

  if (totalEvents === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 text-sm text-[var(--color-primary-700)]">
          <p>
            No events in the planning feed yet. Ask Ops to load sample events if you need a walkthrough.
          </p>
          <p className="text-xs text-[var(--color-primary-600)]">
            The dashboard populates automatically as events start flowing in.
          </p>
        </CardContent>
      </Card>
    );
  }

  const submittedCount = analytics.statusCounts.submitted ?? 0;
  const revisionsCount = analytics.statusCounts.needs_revisions ?? 0;
  const approvedCount = analytics.statusCounts.approved ?? 0;
  const conflictsCount = analytics.conflicts.length;
  const awaitingCount = analytics.awaitingReviewer.length;
  const upcomingCount = analytics.upcoming.length;
  const reviewerCount = analytics.reviewerSla.length;

  const submittedShare = Math.round((submittedCount / totalEvents) * 100);
  const revisionsShare = Math.round((revisionsCount / totalEvents) * 100);
  const approvedShare = Math.round((approvedCount / totalEvents) * 100);

  const awaitingPreview = analytics.awaitingReviewer.slice(0, 5);
  const conflictPreview = analytics.conflicts.slice(0, 6);
  const reviewerSlaPreview = analytics.reviewerSla.slice(0, 4);
  const calendarConflictCount = analytics.calendarEvents.filter((event) => event.conflict).length;
  const nextCalendarEvent = analytics.calendarEvents[0];
  const queuedSlaWarningCount = analytics.slaWarningQueued ?? 0;
  const metadataCalendarUrl =
    analytics.metadata?.calendarFeedUrl ?? "/api/planning-feed/calendar";
  const metadataGeneratedAt = analytics.metadata?.generatedAt ?? null;

  type SummaryPill = {
    label: string;
    value: string;
    trendLabel: string;
    trendVariant: "up" | "down" | "flat";
  };

  const summaryPills: SummaryPill[] = [
    {
      label: "Total events",
      value: totalEvents.toLocaleString(),
      trendLabel: `${upcomingCount.toLocaleString()} upcoming`,
      trendVariant: "flat",
    },
    {
      label: "Submitted",
      value: submittedCount.toLocaleString(),
      trendLabel: `${submittedShare}% of pipeline`,
      trendVariant: submittedShare > 35 ? "down" : "flat",
    },
    {
      label: "Needs revisions",
      value: revisionsCount.toLocaleString(),
      trendLabel:
        revisionsCount === 0 ? "All clear" : `${revisionsShare}% need updates`,
      trendVariant:
        revisionsCount === 0 ? "up" : revisionsShare > 20 ? "down" : "flat",
    },
    {
      label: "Approved",
      value: approvedCount.toLocaleString(),
      trendLabel: `${approvedShare}% ready for publish`,
      trendVariant: approvedShare >= 50 ? "up" : "flat",
    },
    {
      label: "Conflicts",
      value: conflictsCount.toLocaleString(),
      trendLabel:
        conflictsCount > 0 ? `${conflictsCount.toLocaleString()} flagged` : "Calendar clear",
      trendVariant: conflictsCount > 0 ? "down" : "up",
    },
  ];

  return (
    <div className="space-y-6">
      {error ? (
        <Alert
          variant="warning"
          title="Analytics refresh failed"
          description="Unable to refresh analytics from the API. Showing cached data."
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        {summaryPills.map((pill) => (
          <StatPill
            key={pill.label}
            label={pill.label}
            value={pill.value}
            trendLabel={pill.trendLabel}
            trendVariant={pill.trendVariant}
          />
        ))}
      </div>

      {awaitingCount > 0 ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Submitted awaiting reviewer</CardTitle>
                <CardDescription>
                  Reassign or follow up on these submissions to keep the queue flowing.
                </CardDescription>
              </div>
              <Badge variant="warning">
                {awaitingCount.toLocaleString()} waiting
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {awaitingPreview.map((event) => (
              <div
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[rgba(42,79,168,0.18)] bg-[var(--color-muted-surface)] p-3 text-sm text-[var(--color-primary-900)]"
              >
                <div className="flex flex-col gap-1">
                  <Link
                    href={buildEventHref(event.id, { source: "planning", hash: "timeline" })}
                    className="font-semibold text-[var(--color-primary-900)] transition hover:text-[var(--color-primary-700)] hover:underline"
                  >
                    {event.title}
                  </Link>
                  <span className="text-xs text-[var(--color-primary-600)]">
                    {event.venueName ?? "Unknown venue"} · {event.venueSpace ?? "General space"}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs text-[var(--color-primary-600)]">
                  <span>{formatDateTime(event.startAt)}</span>
                  <Badge variant="info">Awaiting coverage</Badge>
                </div>
              </div>
            ))}
            {awaitingCount > awaitingPreview.length ? (
              <p className="text-xs text-[var(--color-primary-600)]">
                {(awaitingCount - awaitingPreview.length).toLocaleString()} additional submission
                {awaitingCount - awaitingPreview.length === 1 ? "" : "s"} awaiting coverage.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Alert
          variant="success"
          title="Reviewer coverage clear"
          description="All submitted events have a reviewer assigned."
        />
      )}

      {conflictsCount > 0 ? (
        <Card className="border-[rgba(196,125,78,0.35)] bg-[rgba(196,125,78,0.1)]">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-[var(--color-accent-warm-dark)]">
                  Venue-space conflicts
                </CardTitle>
                <CardDescription className="text-[var(--color-accent-warm-dark)]">
                  Use the conflict timeline link to jump straight into the event history view.
                </CardDescription>
              </div>
              <Badge variant="warning">
                {conflictsCount.toLocaleString()} overlap{conflictsCount === 1 ? "" : "s"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-[var(--color-accent-warm-dark)]">
            {conflictPreview.map((pair) => (
              <ConflictPairCard key={pair.key} pair={pair} />
            ))}
            {conflictsCount > conflictPreview.length ? (
              <p className="text-xs">
                {(conflictsCount - conflictPreview.length).toLocaleString()} additional conflict
                {conflictsCount - conflictPreview.length === 1 ? "" : "s"} not shown.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Alert
          variant="success"
          title="No venue conflicts flagged"
          description="Add the planning calendar link to get notified when new overlaps land."
        />
      )}

      {queuedSlaWarningCount > 0 ? (
        <Alert
          variant="warning"
          title="Reminder emails queued"
          description="We’re retrying these reminder emails. If the queue keeps growing, open the reminder automation panel for more detail."
        >
          <p className="mt-2 text-xs">
            {queuedSlaWarningCount.toLocaleString()} pending email
            {queuedSlaWarningCount === 1 ? "" : "s"}.
          </p>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Reviewer response trend</CardTitle>
                <CardDescription>
                  Submitted events grouped by urgency to highlight where to intervene first.
                </CardDescription>
              </div>
              <Badge variant="info">
                {reviewerCount.toLocaleString()} reviewer{reviewerCount === 1 ? "" : "s"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {reviewerCount === 0 ? (
              <p className="text-sm text-[var(--color-primary-600)]">
                No submitted events currently assigned to reviewers.
              </p>
            ) : (
              <ul className="space-y-3">
                {reviewerSlaPreview.map((snapshot) => (
                  <li
                    key={snapshot.reviewerId}
                    className="rounded-[var(--radius)] border border-[rgba(42,79,168,0.18)] bg-white/95 p-3 text-sm text-[var(--color-primary-900)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-[var(--color-primary-900)]">
                          {snapshot.reviewerName ?? "Unassigned reviewer"}
                        </span>
                        <span className="text-xs text-[var(--color-primary-600)]">
                          {snapshot.totalAssigned.toLocaleString()} submission
                          {snapshot.totalAssigned === 1 ? "" : "s"} assigned
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="success">
                          OK {snapshot.onTrack.toLocaleString()}
                        </Badge>
                        <Badge variant="warning">
                          Warn {snapshot.warning.toLocaleString()}
                        </Badge>
                        <Badge variant="danger">
                          Overdue {snapshot.overdue.toLocaleString()}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-[var(--color-primary-600)]">
                      Next due:{" "}
                      {snapshot.nextDueAt
                        ? formatDateTime(snapshot.nextDueAt)
                        : "No scheduled date"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {reviewerCount > reviewerSlaPreview.length ? (
              <p className="mt-3 text-xs text-[var(--color-primary-600)]">
                {(reviewerCount - reviewerSlaPreview.length).toLocaleString()} additional reviewer
                {reviewerCount - reviewerSlaPreview.length === 1 ? "" : "s"} not shown.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Calendar feed</CardTitle>
                <CardDescription>
                  Export upcoming events (with conflict flags) into your calendar tool of choice.
                </CardDescription>
              </div>
              <Badge variant="info">Calendar</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[var(--color-primary-700)]">
            <dl className="space-y-2">
              <div className="flex items-center justify-between">
                <dt>Events exported</dt>
                <dd className="font-semibold text-[var(--color-primary-900)]">
                  {analytics.calendarEvents.length.toLocaleString()}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Conflicts highlighted</dt>
                <dd className="font-semibold text-[var(--color-accent-warm-dark)]">
                  {calendarConflictCount.toLocaleString()}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt>Next event</dt>
                <dd className="font-semibold text-[var(--color-primary-900)]">
                  {nextCalendarEvent ? formatDateTime(nextCalendarEvent.startAt) : "—"}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={metadataCalendarUrl}>Download calendar file</a>
              </Button>
              <span className="text-xs text-[var(--color-primary-600)]">
                Conflicted events include “Conflict · …” in the summary so they stand out in calendar views.
              </span>
            </div>
            {metadataGeneratedAt ? (
              <p className="text-[10px] uppercase tracking-wide text-[var(--color-primary-500)]">
                Snapshot generated {formatDateTime(metadataGeneratedAt)}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {analytics.upcoming.length > 0 ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Upcoming events</CardTitle>
                <CardDescription>
                  Sorted by start date to drive the planning calendar and weekly digest.
                </CardDescription>
              </div>
              <Badge variant="neutral">
                {analytics.upcoming.length.toLocaleString()} upcoming
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {analytics.upcoming.slice(0, 8).map((event) => (
              <div
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[rgba(42,79,168,0.18)] bg-white/95 p-3 text-sm text-[var(--color-primary-900)]"
              >
                <div className="flex flex-col gap-1">
                  <Link
                    href={buildEventHref(event.id, { source: "planning" })}
                    className="font-semibold text-[var(--color-primary-900)] transition hover:text-[var(--color-primary-700)] hover:underline"
                  >
                    {event.title}
                  </Link>
                  <span className="text-xs text-[var(--color-primary-600)]">
                    {event.venueName ?? "Unknown venue"} · {event.venueSpace ?? "General space"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-primary-600)]">
                  <span>{formatDateTime(event.startAt)}</span>
                  <Badge variant={getStatusBadgeVariant(event.status)}>
                    {statusLabels[event.status] ?? event.status}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Alert
          variant="neutral"
          title="No upcoming events"
          description="It looks quiet right now. Ask Ops to add sample events if you need a demo."
        />
      )}
    </div>
  );
}

export default PlanningAnalyticsClient;

type ConflictPairCardProps = {
  pair: PlanningAnalyticsResponse["conflicts"][number];
};

function ConflictPairCard({ pair }: ConflictPairCardProps) {
  return (
    <div className="space-y-3 rounded-[var(--radius)] border border-[rgba(196,125,78,0.3)] bg-white/80 p-4 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-[var(--color-accent-warm-dark)]">
            {pair.venueName}
          </span>
          <span className="text-xs text-[var(--color-accent-warm-dark)]">
            {pair.venueSpace}
          </span>
        </div>
        <Badge variant="warning">Conflict window</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ConflictEventCard event={pair.first} />
        <ConflictEventCard event={pair.second} />
      </div>
    </div>
  );
}

type ConflictEventCardProps = {
  event: EventSummary;
};

function ConflictEventCard({ event }: ConflictEventCardProps) {
  const statusLabel = statusLabels[event.status] ?? event.status;
  const timelineHref = buildEventHref(event.id, {
    source: "conflict",
    hash: "timeline",
  });
  const detailHref = buildEventHref(event.id, { source: "planning" });

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-[rgba(196,125,78,0.25)] bg-[rgba(196,125,78,0.12)] p-3 text-xs text-[var(--color-accent-warm-dark)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link
          href={detailHref}
          className="text-sm font-semibold text-[var(--color-accent-warm-dark)] transition hover:text-[var(--color-accent-warm-dark)]/80 hover:underline"
        >
          {event.title}
        </Link>
        <Badge variant={getStatusBadgeVariant(event.status)}>{statusLabel}</Badge>
      </div>
      <p>
        {formatDateTime(event.startAt)} · {event.venueSpace ?? "General space"}
      </p>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="h-8 justify-center border-[rgba(196,125,78,0.4)] text-[var(--color-accent-warm-dark)] hover:bg-[rgba(196,125,78,0.18)]"
      >
        <Link href={timelineHref}>Open timeline</Link>
      </Button>
      <Link
        href={detailHref}
        className="text-[11px] font-semibold text-[var(--color-accent-warm-dark)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-accent-warm-dark)]/80"
      >
        View event detail
      </Link>
    </div>
  );
}
