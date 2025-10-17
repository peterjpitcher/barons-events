"use client";

import { useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";

type EventSummary = {
  id: string;
  title: string;
  status: string;
  startAt: string | null;
  venueName: string | null;
  venueSpace: string | null;
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
  const calendarHref = analytics.metadata?.calendarFeedUrl ?? "/api/planning-feed/calendar";
  const subscribeCopy = `Subscribe HQ exec calendars to ${calendarHref} so conflict alerts land alongside the weekly digest.`;

  return (
    <div className="space-y-4 rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-black">Executive digest preview</h2>
        <p className="text-sm text-black/70">
          Quick snapshot of the metrics and highlights that feed the weekly executive digest.
        </p>
      </header>

      {error ? (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Unable to refresh digest metrics; showing cached snapshot.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-black/15 bg-black/[0.02] p-3">
        <div className="flex max-w-md flex-col gap-1 text-xs text-black/60">
          <span>{subscribeCopy}</span>
          <span className="text-[11px] text-black/50">
            Checklist reference: <code>docs/Runbooks/ExecutiveCalendar.md</code>
          </span>
        </div>
        <a
          href={calendarHref}
          className="inline-flex items-center rounded-full border border-black/[0.12] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/50"
        >
          Subscribe via ICS
        </a>
      </div>

      <dl className="grid gap-3 sm:grid-cols-4">
        <DigestMetric label="Submitted" value={submitted} tone="text-amber-700" />
        <DigestMetric label="Needs revisions" value={needsRevisions} tone="text-rose-700" />
        <DigestMetric label="Approved" value={approved} tone="text-emerald-700" />
        <DigestMetric label="Venue conflicts" value={conflicts} tone="text-black" />
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-black/60">
          Awaiting reviewer coverage
        </h3>
        <span className="text-xs text-black/50">
          {awaitingReviewer} submission{awaitingReviewer === 1 ? "" : "s"}
        </span>
      </div>

      <div className="space-y-2 rounded-lg border border-black/[0.06] bg-black/[0.015] p-3 text-sm text-black/80">
        {upcoming.length === 0 ? (
          <p className="text-sm text-black/60">No upcoming events in the digest window.</p>
        ) : (
          upcoming.slice(0, 5).map((event) => (
            <div
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-sm text-black/80"
            >
              <div className="flex flex-col">
                <Link
                  href={`/events/${event.id}`}
                  className="font-medium text-black transition hover:text-black/80 hover:underline"
                >
                  {event.title}
                </Link>
                <span className="text-xs text-black/60">
                  {event.venueName ?? "Venue TBC"} · {event.venueSpace ?? "General space"}
                </span>
              </div>
              <span className="text-xs text-black/60">{formatDateTime(event.startAt)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

type DigestMetricProps = {
  label: string;
  value: number;
  tone: string;
};

function DigestMetric({ label, value, tone }: DigestMetricProps) {
  return (
    <div className="rounded-lg border border-black/[0.06] bg-black/[0.02] px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-black/50">{label}</dt>
      <dd className={`text-2xl font-semibold ${tone}`}>{value}</dd>
    </div>
  );
}
