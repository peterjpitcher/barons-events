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
      activeTone: "border-[var(--burgundy)] bg-[var(--burgundy-tint)] text-[var(--burgundy)]",
      defaultTone: "border-[var(--hair)] bg-[var(--paper)] text-[var(--ink)]"
    },
    {
      label: "Overdue tasks",
      value: alerts.overdueTasks,
      icon: ListChecks,
      filterKey: "overdue_tasks",
      activeTone: "border-[var(--mustard)] bg-[var(--mustard-tint)] text-[var(--mustard-dark)]",
      defaultTone: "border-[var(--hair)] bg-[var(--paper)] text-[var(--ink)]"
    },
    {
      label: "Due soon items (7d)",
      value: alerts.dueSoonItems,
      icon: Clock3,
      filterKey: "due_soon_items",
      activeTone: "border-[var(--slate)] bg-[var(--slate-tint)] text-[var(--slate)]",
      defaultTone: "border-[var(--hair)] bg-[var(--paper)] text-[var(--ink)]"
    },
    {
      label: "Due soon tasks (7d)",
      value: alerts.dueSoonTasks,
      icon: Clock3,
      filterKey: "due_soon_tasks",
      activeTone: "border-[var(--sage-dark)] bg-[var(--sage-tint)] text-[var(--sage-dark)]",
      defaultTone: "border-[var(--hair)] bg-[var(--paper)] text-[var(--ink)]"
    }
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map((row) => {
        const Icon = row.icon;
        const isSelected = activeFilter === row.filterKey;
        const hasValue = row.value > 0;
        const tone = isSelected
          ? row.activeTone + " ring-2 ring-[var(--mustard-tint)] ring-offset-1"
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
            className={`rounded-[9px] border px-3 py-2 text-left shadow-card transition-all ${tone} ${isClickable ? "cursor-pointer hover:-translate-y-px hover:ring-2 hover:ring-[var(--mustard-tint)] hover:ring-offset-1" : ""} disabled:cursor-default`}
          >
            <span className="flex items-center gap-2 font-brand-mono text-[0.625rem] font-semibold uppercase tracking-[0.12em]">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {row.label}
            </span>
            <span className="mt-1 block font-brand-serif text-[1.7rem] font-medium leading-none">{row.value}</span>
          </button>
        );
      })}
    </div>
  );
}
