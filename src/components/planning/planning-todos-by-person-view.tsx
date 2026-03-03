"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { PlanningItem } from "@/lib/planning/types";
import { formatDate } from "@/lib/utils/format";

type PlanningTodosByPersonViewProps = {
  items: PlanningItem[];
  onOpenPlanningItem: (item: PlanningItem) => void;
};

type PersonTaskRow = {
  taskId: string;
  title: string;
  dueDate: string;
  status: "open" | "done";
  assigneeId: string | null;
  assigneeName: string;
  planningItem: PlanningItem;
};

function sortTasks(rows: PersonTaskRow[]): PersonTaskRow[] {
  return [...rows].sort((left, right) => {
    if (left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate);
    if (left.status !== right.status) return left.status === "open" ? -1 : 1;
    if (left.planningItem.title !== right.planningItem.title) {
      return left.planningItem.title.localeCompare(right.planningItem.title);
    }
    return left.title.localeCompare(right.title);
  });
}

export function PlanningTodosByPersonView({ items, onOpenPlanningItem }: PlanningTodosByPersonViewProps) {
  const grouped = useMemo(() => {
    const result = new Map<string, { label: string; tasks: PersonTaskRow[] }>();

    items.forEach((item) => {
      item.tasks.forEach((task) => {
        const key = task.assigneeId ?? "tbd";
        const label = task.assigneeName || "To be determined";
        const bucket = result.get(key) ?? { label, tasks: [] };
        bucket.tasks.push({
          taskId: task.id,
          title: task.title,
          dueDate: task.dueDate,
          status: task.status,
          assigneeId: task.assigneeId,
          assigneeName: task.assigneeName,
          planningItem: item
        });
        result.set(key, bucket);
      });
    });

    return Array.from(result.entries())
      .map(([key, value]) => ({
        key,
        label: value.label,
        tasks: sortTasks(value.tasks)
      }))
      .sort((left, right) => {
        if (left.key === "tbd") return 1;
        if (right.key === "tbd") return -1;
        return left.label.localeCompare(right.label);
      });
  }, [items]);

  const totalTasks = grouped.reduce((sum, group) => sum + group.tasks.length, 0);

  return (
    <section className="space-y-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-3 shadow-soft">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] pb-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-primary-700)]">Todos by person</h2>
          <p className="text-sm text-subtle">Task workload grouped by assignee, each list sorted by due date.</p>
        </div>
        <p className="text-sm font-semibold text-[var(--color-text)]">{totalTasks} task{totalTasks === 1 ? "" : "s"}</p>
      </header>

      {grouped.length === 0 ? (
        <p className="text-sm text-subtle">No tasks found for the current filters.</p>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => {
            const openCount = group.tasks.filter((task) => task.status === "open").length;
            return (
              <article key={group.key} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-muted-surface)] p-2.5">
                <header className="mb-1.5 flex items-center justify-between gap-2 border-b border-[var(--color-border)] pb-1.5">
                  <h3 className="text-base font-semibold text-[var(--color-text)]">{group.label}</h3>
                  <p className="text-xs font-medium text-subtle">
                    {openCount} open / {group.tasks.length} total
                  </p>
                </header>

                <div className="space-y-1.5">
                  {group.tasks.map((task) => {
                    const isOpen = task.status === "open";
                    return (
                      <div key={task.taskId} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white px-2.5 py-1.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className={`text-sm ${isOpen ? "font-semibold text-[var(--color-text)]" : "text-subtle line-through"}`}>
                              {task.title}
                            </p>
                            <p className="text-xs text-subtle">
                              Due {formatDate(task.dueDate)} · Item {task.planningItem.title}
                            </p>
                          </div>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em] ${
                              isOpen
                                ? "border-[var(--color-primary-400)] bg-[rgba(39,54,64,0.08)] text-[var(--color-primary-700)]"
                                : "border-[var(--color-border)] bg-[var(--color-muted-surface)] text-subtle"
                            }`}
                          >
                            {task.status}
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <Button type="button" size="sm" variant="ghost" onClick={() => onOpenPlanningItem(task.planningItem)}>
                            Open item
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
