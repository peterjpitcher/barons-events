"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanningItem } from "@/lib/planning/types";
import { addDays } from "@/lib/planning/utils";
import type { PlanningViewEntry } from "@/components/planning/view-types";

type PlanningCalendarViewProps = {
  today: string;
  entries: PlanningViewEntry[];
  onOpenPlanningItem: (item: PlanningItem) => void;
  onMovePlanningItem: (itemId: string, targetDate: string) => void;
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseDateKey(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function monthKey(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function formatMonthHeading(value: string): string {
  const parsed = parseDateKey(value);
  return parsed.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addMonths(value: string, deltaMonths: number): string {
  const parsed = parseDateKey(value);
  parsed.setUTCMonth(parsed.getUTCMonth() + deltaMonths);
  parsed.setUTCDate(1);
  return toDateKey(parsed);
}

function startOfCalendarGrid(monthStart: string): string {
  const parsed = parseDateKey(monthStart);
  const weekday = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - weekday);
  return toDateKey(parsed);
}

function formatDayNumber(dateKey: string): string {
  return parseDateKey(dateKey).toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" });
}

const SOURCE_RANK: Record<string, number> = { planning: 0, event: 1, inspiration: 2 };

function sortEntries(entries: PlanningViewEntry[]): PlanningViewEntry[] {
  return [...entries].sort((left, right) => {
    const lr = SOURCE_RANK[left.source] ?? 3;
    const rr = SOURCE_RANK[right.source] ?? 3;
    if (lr !== rr) return lr - rr;
    return left.title.localeCompare(right.title);
  });
}

export function PlanningCalendarView({ today, entries, onOpenPlanningItem, onMovePlanningItem }: PlanningCalendarViewProps) {
  const [activeMonth, setActiveMonth] = useState(monthKey(today));
  const [draggedPlanningItem, setDraggedPlanningItem] = useState<{
    itemId: string;
    sourceDate: string;
    title: string;
  } | null>(null);

  const entriesByDate = useMemo(() => {
    const result = new Map<string, PlanningViewEntry[]>();
    entries.forEach((entry) => {
      const rows = result.get(entry.targetDate) ?? [];
      rows.push(entry);
      result.set(entry.targetDate, rows);
    });
    Array.from(result.keys()).forEach((dateKey) => {
      result.set(dateKey, sortEntries(result.get(dateKey) ?? []));
    });
    return result;
  }, [entries]);

  const dayCells = useMemo(() => {
    const startDate = startOfCalendarGrid(activeMonth);
    return Array.from({ length: 42 }, (_, index) => addDays(startDate, index));
  }, [activeMonth]);

  return (
    <section className="space-y-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-4 shadow-soft">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-[var(--color-primary-700)]">Calendar view</h2>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setActiveMonth((current) => addMonths(current, -1))}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Prev
          </Button>
          <p className="min-w-[11rem] text-center text-sm font-semibold text-[var(--color-text)]">{formatMonthHeading(activeMonth)}</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => setActiveMonth((current) => addMonths(current, 1))}>
            Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </header>

      {draggedPlanningItem ? (
        <p className="text-xs text-subtle">Drop “{draggedPlanningItem.title}” on a day to move it.</p>
      ) : null}

      <div className="grid grid-cols-7 gap-2">
        {WEEKDAY_LABELS.map((label) => (
          <p key={label} className="px-2 text-xs font-semibold uppercase tracking-[0.08em] text-subtle">
            {label}
          </p>
        ))}
        {dayCells.map((dateKey) => {
          const inActiveMonth = dateKey.slice(0, 7) === activeMonth.slice(0, 7);
          const rows = entriesByDate.get(dateKey) ?? [];
          const isDropCandidate = draggedPlanningItem ? draggedPlanningItem.sourceDate !== dateKey : false;
          return (
            <article
              key={dateKey}
              onDragOver={(event) => {
                if (!draggedPlanningItem) return;
                event.preventDefault();
              }}
              onDrop={() => {
                if (!draggedPlanningItem) return;
                const { itemId, sourceDate } = draggedPlanningItem;
                setDraggedPlanningItem(null);
                if (sourceDate === dateKey) return;
                onMovePlanningItem(itemId, dateKey);
              }}
              className={`min-h-[7.5rem] rounded-[var(--radius-sm)] border p-2 ${
                inActiveMonth
                  ? "border-[var(--color-border)] bg-white"
                  : "border-[rgba(39,54,64,0.12)] bg-[var(--color-muted-surface)]"
              } ${isDropCandidate ? "ring-1 ring-[var(--color-primary-500)]" : ""}`}
            >
              <p className={`text-xs font-semibold ${inActiveMonth ? "text-[var(--color-text)]" : "text-subtle"}`}>{formatDayNumber(dateKey)}</p>
              <div className="mt-2 space-y-1">
                {rows.slice(0, 3).map((entry) => {
                  if (entry.source === "planning") {
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        draggable
                        onDragStart={() =>
                          setDraggedPlanningItem({
                            itemId: entry.planningItem.id,
                            sourceDate: entry.targetDate,
                            title: entry.title
                          })
                        }
                        onDragEnd={() => setDraggedPlanningItem(null)}
                        onClick={() => onOpenPlanningItem(entry.planningItem)}
                        className="block w-full cursor-grab rounded-[var(--radius-sm)] border-l-4 border-[var(--color-primary-600)] bg-[var(--color-muted-surface)] px-2 py-1 text-left text-[0.72rem] leading-tight text-[var(--color-text)] hover:bg-[rgba(39,54,64,0.08)] active:cursor-grabbing"
                        title={entry.title}
                      >
                        {entry.title}
                      </button>
                    );
                  }

                  if (entry.source === "inspiration") {
                    return (
                      <div
                        key={entry.id}
                        className="block rounded-[var(--radius-sm)] border-l-4 border-amber-400 bg-amber-50 px-2 py-1 text-[0.72rem] leading-tight text-[var(--color-text)]"
                        title={entry.title}
                      >
                        ✨ {entry.title}
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={entry.id}
                      href={`/events/${entry.eventId}`}
                      className="block rounded-[var(--radius-sm)] border-l-4 border-[var(--color-accent-warm)] bg-[rgba(39,54,64,0.04)] px-2 py-1 text-[0.72rem] leading-tight text-[var(--color-text)] hover:bg-[rgba(39,54,64,0.08)]"
                      title={entry.title}
                    >
                      {entry.title}
                    </Link>
                  );
                })}
                {rows.length > 3 ? (
                  <p className="px-1 text-[0.7rem] text-subtle">+{rows.length - 3} more</p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
