"use client";

import type { EventSummary } from "@/lib/events/analytics";

type ExecutiveDigestPanelProps = {
  statusCounts: Record<string, number>;
  conflicts: number;
  awaitingReviewer: number;
  upcoming: EventSummary[];
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
  statusCounts,
  conflicts,
  awaitingReviewer,
  upcoming,
}: ExecutiveDigestPanelProps) {
  const submitted = statusCounts.submitted ?? 0;
  const needsRevisions = statusCounts.needs_revisions ?? 0;
  const approved = statusCounts.approved ?? 0;

  return (
    <div className="space-y-4 rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-black">Executive digest preview</h2>
        <p className="text-sm text-black/70">
          Quick snapshot of the metrics and highlights that feed the weekly executive digest.
        </p>
      </header>

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
                <span className="font-medium text-black">{event.title}</span>
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
