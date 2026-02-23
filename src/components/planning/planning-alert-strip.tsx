import { AlertTriangle, Clock3, ListChecks } from "lucide-react";
import type { PlanningAlertCounts } from "@/lib/planning/types";

type PlanningAlertStripProps = {
  alerts: PlanningAlertCounts;
};

export function PlanningAlertStrip({ alerts }: PlanningAlertStripProps) {
  const rows = [
    {
      label: "Overdue items",
      value: alerts.overdueItems,
      icon: AlertTriangle,
      tone:
        alerts.overdueItems > 0
          ? "border-[rgba(110,60,61,0.4)] bg-[rgba(110,60,61,0.08)] text-[var(--color-antique-burgundy)]"
          : "border-[var(--color-border)] bg-white text-[var(--color-text)]"
    },
    {
      label: "Overdue tasks",
      value: alerts.overdueTasks,
      icon: ListChecks,
      tone:
        alerts.overdueTasks > 0
          ? "border-[rgba(166,90,46,0.45)] bg-[rgba(166,90,46,0.09)] text-[var(--color-primary-700)]"
          : "border-[var(--color-border)] bg-white text-[var(--color-text)]"
    },
    {
      label: "Due soon items (7d)",
      value: alerts.dueSoonItems,
      icon: Clock3,
      tone: "border-[var(--color-border)] bg-white text-[var(--color-text)]"
    },
    {
      label: "Due soon tasks (7d)",
      value: alerts.dueSoonTasks,
      icon: Clock3,
      tone: "border-[var(--color-border)] bg-white text-[var(--color-text)]"
    }
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map((row) => {
        const Icon = row.icon;
        return (
          <article key={row.label} className={`rounded-[var(--radius)] border px-3 py-2 shadow-soft ${row.tone}`}>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em]">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {row.label}
            </p>
            <p className="mt-1 text-2xl font-semibold">{row.value}</p>
          </article>
        );
      })}
    </div>
  );
}
