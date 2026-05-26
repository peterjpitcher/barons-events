"use client";

import Link from "next/link";
import type { PlanningItem } from "@/lib/planning/types";
import { addDays, daysBetween } from "@/lib/planning/utils";
import type { PlanningViewEntry } from "@/components/planning/view-types";

type PlanningListViewProps = {
  today: string;
  entries: PlanningViewEntry[];
  onOpenPlanningItem?: (item: PlanningItem) => void;
};

type BoundaryMarker = {
  key: "30" | "60" | "90";
  label: string;
  date: string;
  className: string;
};

function formatDateHeading(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
}

function formatOffset(today: string, date: string): string {
  const offset = daysBetween(today, date);
  if (offset === 0) return "Today";
  if (offset > 0) return `+${offset}d`;
  return `${offset}d`;
}

const SOURCE_RANK: Record<string, number> = { planning: 0, event: 1, inspiration: 2 };

function sortEntries(entries: PlanningViewEntry[]): PlanningViewEntry[] {
  return [...entries].sort((left, right) => {
    if (left.targetDate !== right.targetDate) {
      return left.targetDate.localeCompare(right.targetDate);
    }
    const lr = SOURCE_RANK[left.source] ?? 3;
    const rr = SOURCE_RANK[right.source] ?? 3;
    if (lr !== rr) return lr - rr;
    return left.title.localeCompare(right.title);
  });
}

export function PlanningListView({ today, entries, onOpenPlanningItem }: PlanningListViewProps) {
  const sorted = sortEntries(entries);

  const grouped = sorted.reduce<Record<string, PlanningViewEntry[]>>((acc, entry) => {
    acc[entry.targetDate] = acc[entry.targetDate] ?? [];
    acc[entry.targetDate].push(entry);
    return acc;
  }, {});
  const dateKeys = Object.keys(grouped).sort((left, right) => left.localeCompare(right));

  const boundaries: BoundaryMarker[] = [
    {
      key: "30",
      label: "30-day boundary",
      date: addDays(today, 30),
      className: "border-t-4 border-solid border-[var(--sage-dark)] bg-[var(--sage-tint)] text-[var(--sage-dark)]"
    },
    {
      key: "60",
      label: "60-day boundary",
      date: addDays(today, 60),
      className: "border-t-4 border-dashed border-[var(--mustard)] bg-[var(--mustard-tint)] text-[var(--mustard-dark)]"
    },
    {
      key: "90",
      label: "90-day boundary",
      date: addDays(today, 90),
      className: "border-t-4 border-dotted border-[var(--burgundy)] bg-[var(--burgundy-tint)] text-[var(--burgundy)]"
    }
  ];

  let boundaryIndex = 0;

  return (
    <section className="space-y-4 rounded-[var(--radius)] border border-[var(--hair)] bg-[var(--paper)] p-4 shadow-card">
      <header>
        <h2 className="text-lg font-semibold text-[var(--navy)]">Continuous list view</h2>
        <p className="text-sm text-subtle">Everything in one date-ordered feed with 30/60/90 delineation lines.</p>
      </header>

      <div className="space-y-4">
        {dateKeys.map((dateKey) => {
          const content: React.ReactNode[] = [];

          while (boundaryIndex < boundaries.length && boundaries[boundaryIndex].date <= dateKey) {
            const boundary = boundaries[boundaryIndex];
            content.push(
              <div key={`boundary-${boundary.key}-${dateKey}`} className={`rounded-[var(--radius-sm)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${boundary.className}`}>
                {boundary.label} · {formatDateHeading(boundary.date)}
              </div>
            );
            boundaryIndex += 1;
          }

          content.push(
            <article key={`date-${dateKey}`} className="rounded-[var(--radius-sm)] border border-[var(--hair)] bg-[var(--canvas-2)] p-3">
              <header className="mb-2 flex items-baseline justify-between gap-2 border-b border-[var(--hair)] pb-2">
                <h3 className="text-sm font-semibold text-[var(--ink)]">{formatDateHeading(dateKey)}</h3>
                <p className="text-xs font-medium text-subtle">{formatOffset(today, dateKey)}</p>
              </header>
              <div className="space-y-2">
                {grouped[dateKey].map((entry) => {
                  if (entry.source === "planning") {
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => onOpenPlanningItem?.(entry.planningItem)}
                        className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--hair)] border-l-4 border-l-[var(--navy)] bg-[var(--paper)] px-3 py-2 text-left hover:bg-[var(--paper-tint)]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-[var(--ink)]">{entry.title}</span>
                          <span className="block text-xs text-subtle">
                            Planning · {entry.venueLabel} · {entry.status.replace(/_/g, " ")}
                          </span>
                        </span>
                        <span className="text-xs font-semibold text-[var(--navy)]">Open</span>
                      </button>
                    );
                  }

                  if (entry.source === "inspiration") {
                    return (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-dashed border-amber-400 bg-amber-50 px-3 py-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-[var(--ink)]">✨ {entry.title}</span>
                          <span className="block text-xs text-subtle">Inspiration · Seasonal occasion</span>
                        </span>
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={entry.id}
                      href={`/events/${entry.eventId}`}
                      className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--hair)] border-l-4 border-l-[var(--mustard)] bg-[var(--paper)] px-3 py-2 hover:bg-[var(--paper-tint)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[var(--ink)]">{entry.title}</span>
                        <span className="block text-xs text-subtle">
                          Event · {entry.venueLabel} · {entry.status.replace(/_/g, " ")}
                        </span>
                      </span>
                      <span className="text-xs font-semibold text-[var(--navy)]">Open event</span>
                    </Link>
                  );
                })}
              </div>
            </article>
          );

          return <div key={`cluster-${dateKey}`} className="space-y-3">{content}</div>;
        })}

        {boundaryIndex < boundaries.length
          ? boundaries.slice(boundaryIndex).map((boundary) => (
              <div
                key={`boundary-tail-${boundary.key}`}
                className={`rounded-[var(--radius-sm)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${boundary.className}`}
              >
                {boundary.label} · {formatDateHeading(boundary.date)}
              </div>
            ))
          : null}
      </div>
    </section>
  );
}
