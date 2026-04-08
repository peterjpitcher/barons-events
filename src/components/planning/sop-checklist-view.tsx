"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { togglePlanningTaskStatusAction } from "@/actions/planning";
import { Badge } from "@/components/ui/badge";
import { SopTaskRow } from "@/components/planning/sop-task-row";
import { cn } from "@/lib/utils";
import type { PlanningPerson, PlanningTask, PlanningTaskStatus } from "@/lib/planning/types";

type SopChecklistViewProps = {
  tasks: PlanningTask[];
  users: PlanningPerson[];
  itemId: string;
  currentUserId?: string;
  onChanged?: () => void;
};

type FilterMode = "all" | "my_tasks" | "actionable";

type SectionGroup = {
  name: string;
  tasks: PlanningTask[];
  completedCount: number;
  totalCount: number;
};

function groupTasksBySections(tasks: PlanningTask[]): SectionGroup[] {
  const sectionMap = new Map<string, PlanningTask[]>();

  // Sort tasks by sort_order (section_sort * 1000 + task_sort)
  const sorted = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const task of sorted) {
    const section = task.sopSection ?? "Other";
    const existing = sectionMap.get(section);
    if (existing) {
      existing.push(task);
    } else {
      sectionMap.set(section, [task]);
    }
  }

  const groups: SectionGroup[] = [];
  for (const [name, sectionTasks] of sectionMap) {
    groups.push({
      name,
      tasks: sectionTasks,
      completedCount: sectionTasks.filter((t) => t.status === "done").length,
      totalCount: sectionTasks.filter((t) => t.status !== "not_required").length
    });
  }

  return groups;
}

export function SopChecklistView({ tasks, users, itemId, currentUserId, onChanged }: SopChecklistViewProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [hideNotRequired, setHideNotRequired] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Progress summary counts
  const summary = useMemo(() => {
    const complete = tasks.filter((t) => t.status === "done").length;
    const open = tasks.filter((t) => t.status === "open" && !t.isBlocked).length;
    const blocked = tasks.filter((t) => t.status === "open" && t.isBlocked).length;
    const notRequired = tasks.filter((t) => t.status === "not_required").length;
    return { complete, open, blocked, notRequired, total: tasks.length };
  }, [tasks]);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    let result = tasks;

    if (filterMode === "my_tasks" && currentUserId) {
      result = result.filter((t) => t.assignees.some((a) => a.id === currentUserId));
    } else if (filterMode === "actionable") {
      result = result.filter((t) => t.status === "open" && !t.isBlocked);
    }

    if (hideNotRequired) {
      result = result.filter((t) => t.status !== "not_required");
    }

    return result;
  }, [tasks, filterMode, hideNotRequired, currentUserId]);

  // Group filtered tasks by section
  const sections = useMemo(() => groupTasksBySections(filteredTasks), [filteredTasks]);

  function handleStatusChange(taskId: string, status: PlanningTaskStatus): void {
    startTransition(async () => {
      const result = await togglePlanningTaskStatusAction({ taskId, status });
      if (result && typeof result === "object" && "success" in result) {
        if (!result.success) {
          toast.error(result.message ?? "Could not update task.");
          return;
        }
      }
      if (status === "done") {
        toast.success("Task completed.");
      } else if (status === "not_required") {
        toast.success("Task marked not required.");
      } else {
        toast.success("Task reopened.");
      }
      onChanged?.();
    });
  }

  const progressPercent = summary.total > 0
    ? Math.round(((summary.complete + summary.notRequired) / summary.total) * 100)
    : 0;

  return (
    <section className="space-y-3 border-t border-[var(--color-border)] pt-2">
      <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle">SOP Checklist</h4>

      {/* Progress summary bar */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-[var(--color-text)]">{progressPercent}% complete</span>
          <div className="flex items-center gap-1.5 text-subtle">
            <Badge variant="success" className="text-[10px] px-1.5 py-0.5">{summary.complete} done</Badge>
            <Badge variant="neutral" className="text-[10px] px-1.5 py-0.5">{summary.open} open</Badge>
            {summary.blocked > 0 && (
              <Badge variant="warning" className="text-[10px] px-1.5 py-0.5">{summary.blocked} blocked</Badge>
            )}
            {summary.notRequired > 0 && (
              <Badge variant="neutral" className="text-[10px] px-1.5 py-0.5">{summary.notRequired} skipped</Badge>
            )}
          </div>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-[var(--color-success)] transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap items-center gap-1">
        {([
          { key: "all" as const, label: "All" },
          { key: "my_tasks" as const, label: "My tasks" },
          { key: "actionable" as const, label: "Actionable now" }
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilterMode(key)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]",
              filterMode === key
                ? "bg-[var(--color-primary-700)] text-white"
                : "bg-[var(--color-muted-surface)] text-subtle hover:text-[var(--color-text)]"
            )}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setHideNotRequired(!hideNotRequired)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]",
            hideNotRequired
              ? "bg-[var(--color-primary-700)] text-white"
              : "bg-[var(--color-muted-surface)] text-subtle hover:text-[var(--color-text)]"
          )}
        >
          Hide not required
        </button>
      </div>

      {/* Section groups */}
      {sections.length === 0 && (
        <p className="text-sm text-subtle">No tasks match the current filter.</p>
      )}

      {sections.map((section) => (
        <div key={section.name} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text)]">
              {section.name}
            </h5>
            <span className="text-xs text-subtle">
              {section.completedCount}/{section.totalCount} complete
            </span>
          </div>
          <div className="space-y-1">
            {section.tasks.map((task) => (
              <SopTaskRow
                key={task.id}
                task={task}
                currentUserId={currentUserId}
                users={users}
                onStatusChange={handleStatusChange}
                onChanged={onChanged}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
