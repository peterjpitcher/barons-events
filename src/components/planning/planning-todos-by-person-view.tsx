"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, User, Users } from "lucide-react";
import { togglePlanningTaskStatusAction } from "@/actions/planning";
import type { PlanningItem, TodoAlertFilter } from "@/lib/planning/types";
import { addDays } from "@/lib/planning/utils";
import { formatDate } from "@/lib/utils/format";

type PlanningTodosByPersonViewProps = {
  items: PlanningItem[];
  today: string;
  currentUserId?: string;
  canEdit?: boolean;
  alertFilter?: TodoAlertFilter | null;
  onOpenPlanningItem: (item: PlanningItem) => void;
};

type PersonTaskRow = {
  taskId: string;
  title: string;
  dueDate: string;
  status: "open" | "done" | "not_required";
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

function getFilterDescription(alertFilter: TodoAlertFilter | null | undefined): string {
  switch (alertFilter) {
    case "overdue_items":
      return "Tasks from overdue planning items";
    case "overdue_tasks":
      return "Overdue tasks only";
    case "due_soon_items":
      return "Tasks from planning items due in the next 7 days";
    case "due_soon_tasks":
      return "Tasks due in the next 7 days";
    default:
      return "Open tasks due today or overdue, grouped by assignee. Tick to complete.";
  }
}

export function PlanningTodosByPersonView({
  items,
  today,
  currentUserId,
  canEdit = false,
  alertFilter,
  onOpenPlanningItem
}: PlanningTodosByPersonViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticallyDone, setOptimisticallyDone] = useState<Set<string>>(new Set());
  const [showEveryone, setShowEveryone] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const sevenDaysOut = useMemo(() => addDays(today, 7), [today]);

  const grouped = useMemo(() => {
    const result = new Map<string, { label: string; tasks: PersonTaskRow[] }>();

    items.forEach((item) => {
      item.tasks.forEach((task) => {
        // Skip completed or optimistically-done tasks
        if (task.status === "done" || task.status === "not_required" || optimisticallyDone.has(task.id)) return;

        // Apply date filtering based on active alert filter
        const openItemStatuses = ["planned", "in_progress", "blocked"];
        if (alertFilter === "overdue_items") {
          // Show tasks from overdue open planning items (matches server alert logic)
          if (item.targetDate >= today || !openItemStatuses.includes(item.status)) return;
        } else if (alertFilter === "overdue_tasks") {
          // Show tasks with due_date before today
          if (task.dueDate >= today) return;
        } else if (alertFilter === "due_soon_items") {
          // Show tasks from open planning items due within next 7 days
          if (item.targetDate < today || item.targetDate > sevenDaysOut || !openItemStatuses.includes(item.status)) return;
        } else if (alertFilter === "due_soon_tasks") {
          // Show tasks due within next 7 days (including today)
          if (task.dueDate < today || task.dueDate > sevenDaysOut) return;
        } else {
          // Default: only show tasks due today or earlier
          if (task.dueDate > today) return;
        }

        const row: PersonTaskRow = {
          taskId: task.id,
          title: task.title,
          dueDate: task.dueDate,
          status: task.status,
          assigneeId: task.assigneeId,
          assigneeName: task.assigneeName,
          planningItem: item
        };

        if (task.assignees.length === 0) {
          const key = task.assigneeId ?? "tbd";
          const label = task.assigneeName || "To be determined";
          const bucket = result.get(key) ?? { label, tasks: [] };
          bucket.tasks.push(row);
          result.set(key, bucket);
        } else {
          for (const assignee of task.assignees) {
            const bucket = result.get(assignee.id) ?? { label: assignee.name, tasks: [] };
            bucket.tasks.push(row);
            result.set(assignee.id, bucket);
          }
        }
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
        // Current user always first
        if (currentUserId) {
          if (left.key === currentUserId) return -1;
          if (right.key === currentUserId) return 1;
        }
        if (left.key === "tbd") return 1;
        if (right.key === "tbd") return -1;
        return left.label.localeCompare(right.label);
      });
  }, [items, today, sevenDaysOut, alertFilter, currentUserId, optimisticallyDone]);

  // Show everyone when alert filter is active (counts are computed across all users)
  const effectiveShowEveryone = showEveryone || Boolean(alertFilter);

  // Filter to current user only when not showing everyone
  const visibleGroups = useMemo(() => {
    if (effectiveShowEveryone || !currentUserId) return grouped;
    return grouped.filter((group) => group.key === currentUserId);
  }, [grouped, effectiveShowEveryone, currentUserId]);

  const totalOpen = visibleGroups.reduce((sum, group) => sum + group.tasks.length, 0);
  const allTotalOpen = grouped.reduce((sum, group) => sum + group.tasks.length, 0);

  function toggleSection(key: string): void {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleMarkDone(taskId: string): void {
    setOptimisticallyDone((current) => new Set(current).add(taskId));

    startTransition(async () => {
      const result = await togglePlanningTaskStatusAction({ taskId, status: "done" });
      if (!result.success) {
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
          <p className="text-sm text-subtle">{getFilterDescription(alertFilter)}</p>
        </div>
        <div className="flex items-center gap-3">
          {currentUserId && !alertFilter && (
            <button
              type="button"
              onClick={() => setShowEveryone((v) => !v)}
              className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-semibold transition-colors hover:bg-[var(--color-muted-surface)]"
            >
              {showEveryone ? (
                <>
                  <User className="h-3.5 w-3.5" aria-hidden="true" />
                  Show my tasks
                </>
              ) : (
                <>
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  Show everyone ({allTotalOpen})
                </>
              )}
            </button>
          )}
          <p className="text-sm font-semibold text-[var(--color-text)]">{totalOpen} open task{totalOpen === 1 ? "" : "s"}</p>
        </div>
      </header>

      {visibleGroups.length === 0 ? (
        <p className="text-sm text-subtle">
          {!effectiveShowEveryone && currentUserId && allTotalOpen > 0
            ? "No open tasks assigned to you. Click \"Show everyone\" to see all tasks."
            : "No open tasks found for the current filters."}
        </p>
      ) : (
        <div className="space-y-3">
          {visibleGroups.map((group) => {
            const isCollapsed = collapsedSections.has(group.key);
            const isCurrentUser = group.key === currentUserId;

            return (
              <article
                key={group.key}
                className={`rounded-[var(--radius-sm)] border bg-[var(--color-muted-surface)] p-2.5 ${
                  isCurrentUser
                    ? "border-[var(--color-primary-300)]"
                    : "border-[var(--color-border)]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleSection(group.key)}
                  className="flex w-full items-center justify-between gap-2 border-b border-[var(--color-border)] pb-1.5"
                >
                  <span className="flex items-center gap-2">
                    {isCollapsed ? (
                      <ChevronRight className="h-4 w-4 text-subtle" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-subtle" aria-hidden="true" />
                    )}
                    <h3 className="text-base font-semibold text-[var(--color-text)]">
                      {group.label}
                      {isCurrentUser && <span className="ml-1.5 text-xs font-normal text-subtle">(you)</span>}
                    </h3>
                  </span>
                  <p className="text-xs font-medium text-subtle">{group.tasks.length} open</p>
                </button>

                {!isCollapsed && (
                  <div className="mt-1.5 space-y-1.5">
                    {group.tasks.map((task) => {
                      const isOverdue = task.dueDate < today;
                      return (
                        <div
                          key={task.taskId}
                          className={`flex items-start gap-2.5 rounded-[var(--radius-sm)] border bg-white px-2.5 py-2 ${
                            isOverdue
                              ? "border-[rgba(110,60,61,0.3)]"
                              : "border-[var(--color-border)]"
                          }`}
                        >
                          {canEdit && (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => handleMarkDone(task.taskId)}
                              aria-label={`Mark "${task.title}" as done`}
                              className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 border-[var(--color-primary-400)] bg-white hover:bg-[var(--color-primary-50)] disabled:opacity-50"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-[var(--color-text)]">{task.title}</p>
                            <p className="text-xs text-subtle">
                              {isOverdue && <span className="mr-1 inline-flex items-center gap-0.5 font-semibold text-[var(--color-antique-burgundy)]"><AlertTriangle className="h-3 w-3" aria-hidden="true" />Overdue</span>}
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
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
