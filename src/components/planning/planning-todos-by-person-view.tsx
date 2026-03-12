"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { togglePlanningTaskStatusAction } from "@/actions/planning";
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
    if (left.planningItem.title !== right.planningItem.title) {
      return left.planningItem.title.localeCompare(right.planningItem.title);
    }
    return left.title.localeCompare(right.title);
  });
}

export function PlanningTodosByPersonView({ items, onOpenPlanningItem }: PlanningTodosByPersonViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticallyDone, setOptimisticallyDone] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const result = new Map<string, { label: string; tasks: PersonTaskRow[] }>();

    items.forEach((item) => {
      item.tasks.forEach((task) => {
        // Skip tasks that are already done (from server data) or optimistically marked done
        if (task.status === "done" || optimisticallyDone.has(task.id)) return;

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
      .filter((group) => group.tasks.length > 0)
      .sort((left, right) => {
        if (left.key === "tbd") return 1;
        if (right.key === "tbd") return -1;
        return left.label.localeCompare(right.label);
      });
  }, [items, optimisticallyDone]);

  const totalOpen = grouped.reduce((sum, group) => sum + group.tasks.length, 0);

  function handleMarkDone(taskId: string) {
    // Optimistically remove from view immediately
    setOptimisticallyDone((current) => new Set(current).add(taskId));

    startTransition(async () => {
      const result = await togglePlanningTaskStatusAction({ taskId, done: true });
      if (!result.success) {
        // Revert optimistic update on failure
        setOptimisticallyDone((current) => {
          const next = new Set(current);
          next.delete(taskId);
          return next;
        });
        toast.error(result.message ?? "Could not mark task as done.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-3 shadow-soft">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] pb-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-primary-700)]">Todos by person</h2>
          <p className="text-sm text-subtle">Open tasks grouped by assignee, sorted by due date. Tick to complete.</p>
        </div>
        <p className="text-sm font-semibold text-[var(--color-text)]">{totalOpen} open task{totalOpen === 1 ? "" : "s"}</p>
      </header>

      {grouped.length === 0 ? (
        <p className="text-sm text-subtle">No open tasks found for the current filters.</p>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => (
            <article key={group.key} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-muted-surface)] p-2.5">
              <header className="mb-1.5 flex items-center justify-between gap-2 border-b border-[var(--color-border)] pb-1.5">
                <h3 className="text-base font-semibold text-[var(--color-text)]">{group.label}</h3>
                <p className="text-xs font-medium text-subtle">{group.tasks.length} open</p>
              </header>

              <div className="space-y-1.5">
                {group.tasks.map((task) => (
                  <div key={task.taskId} className="flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white px-2.5 py-2">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleMarkDone(task.taskId)}
                      aria-label={`Mark "${task.title}" as done`}
                      className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 border-[var(--color-primary-400)] bg-white hover:bg-[var(--color-primary-50)] disabled:opacity-50"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--color-text)]">{task.title}</p>
                      <p className="text-xs text-subtle">
                        Due {formatDate(task.dueDate)} · {task.planningItem.title}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenPlanningItem(task.planningItem)}
                      className="flex-shrink-0 text-xs font-semibold text-[var(--color-primary-700)] hover:underline"
                    >
                      Open
                    </button>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
