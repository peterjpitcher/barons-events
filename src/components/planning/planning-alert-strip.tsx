import { AlertTriangle, Clock3, ListChecks } from "lucide-react";
import type { PlanningAlertCounts, TodoAlertFilter } from "@/lib/planning/types";

type PlanningAlertStripProps = {
  alerts: PlanningAlertCounts;
  activeFilter?: TodoAlertFilter | null;
  onFilterClick?: (filter: TodoAlertFilter) => void;
};

export function PlanningAlertStrip({ alerts, activeFilter, onFilterClick }: PlanningAlertStripProps) {
  const rows: Array<{
    label: string;
    value: number;
    icon: typeof AlertTriangle;
    filterKey: TodoAlertFilter;
    activeTone: string;
    defaultTone: string;
  }> = [
    {
      label: "Overdue items",
      value: alerts.overdueItems,
      icon: AlertTriangle,
      filterKey: "overdue_items",
      activeTone: "border-[rgba(110,60,61,0.4)] bg-[rgba(110,60,61,0.08)] text-[var(--color-antique-burgundy)]",
      defaultTone: "border-[var(--color-border)] bg-white text-[var(--color-text)]"
    },
    {
      label: "Overdue tasks",
      value: alerts.overdueTasks,
      icon: ListChecks,
      filterKey: "overdue_tasks",
      activeTone: "border-[rgba(166,90,46,0.45)] bg-[rgba(166,90,46,0.09)] text-[var(--color-primary-700)]",
      defaultTone: "border-[var(--color-border)] bg-white text-[var(--color-text)]"
    },
    {
      label: "Due soon items (7d)",
      value: alerts.dueSoonItems,
      icon: Clock3,
      filterKey: "due_soon_items",
      activeTone: "border-[rgba(166,90,46,0.45)] bg-[rgba(166,90,46,0.09)] text-[var(--color-primary-700)]",
      defaultTone: "border-[var(--color-border)] bg-white text-[var(--color-text)]"
    },
    {
      label: "Due soon tasks (7d)",
      value: alerts.dueSoonTasks,
      icon: Clock3,
      filterKey: "due_soon_tasks",
      activeTone: "border-[rgba(166,90,46,0.45)] bg-[rgba(166,90,46,0.09)] text-[var(--color-primary-700)]",
      defaultTone: "border-[var(--color-border)] bg-white text-[var(--color-text)]"
    }
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map((row) => {
        const Icon = row.icon;
        const isSelected = activeFilter === row.filterKey;
        const hasValue = row.value > 0;
        const tone = isSelected
          ? row.activeTone + " ring-2 ring-[var(--color-primary-400)] ring-offset-1"
          : hasValue
            ? row.activeTone
            : row.defaultTone;
        const isClickable = Boolean(onFilterClick) && row.value > 0;

        return (
          <button
            key={row.label}
            type="button"
            disabled={!isClickable}
            onClick={() => onFilterClick?.(row.filterKey)}
            className={`rounded-[var(--radius)] border px-3 py-2 text-left shadow-soft transition-all ${tone} ${isClickable ? "cursor-pointer hover:ring-2 hover:ring-[var(--color-primary-300)] hover:ring-offset-1" : ""} disabled:cursor-default`}
          >
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em]">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {row.label}
            </span>
            <span className="mt-1 block text-2xl font-semibold">{row.value}</span>
          </button>
        );
      })}
    </div>
  );
}
