"use client";

import { useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardSurface,
} from "@/components/ui/card";
import { StatPill } from "@/components/ui/stat-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

type EventSummary = {
  id: string;
  title: string;
  status: string;
  startAt: string | null;
  venueName: string | null;
  venueSpace: string | null;
  areas?: Array<{ id: string; name: string | null; capacity: number | null }>;
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
  metadata?: {
    calendarFeedUrl: string;
    generatedAt: string;
  };
};

type ExecutiveDigestPanelProps = {
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
  if (!value) return "Date TBC";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date TBC";
    return date.toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Date TBC";
  }
};

export function ExecutiveDigestPanel({
  initialData,
}: ExecutiveDigestPanelProps) {
  const { data, error } = useSWR("/api/planning-feed", fetcher, {
    fallbackData: initialData,
    revalidateOnFocus: false,
  });

  const analytics = useMemo(() => data ?? initialData, [data, initialData]);

  const submitted = analytics.statusCounts.submitted ?? 0;
  const needsRevisions = analytics.statusCounts.needs_revisions ?? 0;
  const approved = analytics.statusCounts.approved ?? 0;
  const awaitingReviewer = analytics.awaitingReviewer.length;
  const conflicts = analytics.conflicts.length;
  const upcoming = analytics.upcoming;
  const calendarHref =
    analytics.metadata?.calendarFeedUrl ?? "/api/planning-feed/calendar";
  const subscribeCopy =
    "Share this calendar link with central leadership so conflict alerts sit alongside their meetings.";
  const executiveRunbookHref =
    "https://github.com/peterjpitcher/barons-events/blob/main/docs/Runbooks/ExecutiveCalendar.md";

  const pipelineTotal = submitted + needsRevisions + approved;
  const approvedShare =
    pipelineTotal > 0 ? Math.round((approved / pipelineTotal) * 100) : 0;
  const revisionShare =
    pipelineTotal > 0 ? Math.round((needsRevisions / pipelineTotal) * 100) : 0;

  type DigestPill = {
    label: string;
    value: string;
    trendLabel: string;
    trendVariant: "up" | "down" | "flat";
  };

  const metricPills: DigestPill[] = [
    {
      label: "Submitted",
      value: submitted.toLocaleString(),
      trendLabel:
        awaitingReviewer > 0
          ? `${awaitingReviewer.toLocaleString()} awaiting reviewer`
          : "Queue covered",
      trendVariant: awaitingReviewer > 0 ? "down" : "up",
    },
    {
      label: "Needs revisions",
      value: needsRevisions.toLocaleString(),
      trendLabel:
        needsRevisions === 0
          ? "All clear"
          : `${revisionShare}% require updates`,
      trendVariant: needsRevisions > 0 ? "down" : "up",
    },
    {
      label: "Approved",
      value: approved.toLocaleString(),
      trendLabel: `${approvedShare}% ready for publish`,
      trendVariant: approvedShare >= 50 ? "up" : "flat",
    },
    {
      label: "Venue conflicts",
      value: conflicts.toLocaleString(),
      trendLabel: conflicts > 0 ? "Conflicts flagged" : "Calendar clear",
      trendVariant: conflicts > 0 ? "down" : "up",
    },
  ];

  const awaitingPreview = analytics.awaitingReviewer.slice(0, 4);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Executive digest preview</CardTitle>
        <CardDescription>
          Quick snapshot of the metrics and highlights that feed the weekly executive digest.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? (
          <Alert
            variant="warning"
            title="Digest refresh failed"
            description="Unable to refresh digest metrics; showing cached snapshot."
          />
        ) : null}

        <CardSurface className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="max-w-md space-y-2 text-sm text-[var(--color-primary-700)]">
            <p>{subscribeCopy}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-primary-600)]">
              <Badge variant="info">Guide</Badge>
              <a
                href={executiveRunbookHref}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-accent-cool-dark)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-primary-900)]"
              >
                Executive calendar guide
              </a>
            </div>
          </div>
          <Button asChild variant="primary" size="sm">
            <a href={calendarHref}>Add to calendar</a>
          </Button>
        </CardSurface>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metricPills.map((pill) => (
            <StatPill
              key={pill.label}
              label={pill.label}
              value={pill.value}
              trendLabel={pill.trendLabel}
              trendVariant={pill.trendVariant}
            />
          ))}
        </div>

        <CardSurface className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-primary-600)]">
              Waiting for reviewer coverage
            </h3>
            <Badge variant={awaitingReviewer > 0 ? "warning" : "success"}>
              {awaitingReviewer.toLocaleString()} waiting
            </Badge>
          </div>
          {awaitingReviewer === 0 ? (
            <p className="text-xs text-[var(--color-primary-600)]">
              All submitted events have reviewers assigned.
            </p>
          ) : (
            <ul className="space-y-2">
              {awaitingPreview.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-[rgba(42,79,168,0.18)] bg-white/95 px-3 py-2 text-xs text-[var(--color-primary-700)] shadow-soft"
                >
                  <div className="flex flex-col">
                    <Link
                      href={`/events/${event.id}`}
                      className="text-sm font-semibold text-[var(--color-primary-900)] transition hover:text-[var(--color-primary-700)] hover:underline"
                    >
                      {event.title}
                    </Link>
                    <span>
                      {event.venueName ?? "Venue TBC"} · {event.venueSpace ?? "General space"}
                    </span>
                  </div>
                  <span>{formatDateTime(event.startAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardSurface>

        <CardSurface className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-primary-600)]">
              Upcoming events
            </h3>
            <Badge variant="neutral">
              {upcoming.length.toLocaleString()}
            </Badge>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-xs text-[var(--color-primary-600)]">
              No upcoming events in the digest window.
            </p>
          ) : (
            <ul className="space-y-2">
              {upcoming.slice(0, 5).map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-[rgba(42,79,168,0.18)] bg-white/95 px-3 py-2 text-sm text-[var(--color-primary-800)] shadow-soft"
                >
                  <div className="flex flex-col">
                    <Link
                      href={`/events/${event.id}`}
                      className="font-semibold text-[var(--color-primary-900)] transition hover:text-[var(--color-primary-700)] hover:underline"
                    >
                      {event.title}
                    </Link>
                    <span className="text-xs text-[var(--color-primary-600)]">
                      {event.venueName ?? "Venue TBC"} · {event.venueSpace ?? "General space"}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--color-primary-600)]">
                    {formatDateTime(event.startAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardSurface>
      </CardContent>
    </Card>
  );
}
