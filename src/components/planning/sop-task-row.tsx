"use client";

import { useState, useTransition } from "react";
import { Check, Minus, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PlanningTask, PlanningTaskStatus } from "@/lib/planning/types";

type SopTaskRowProps = {
  task: PlanningTask;
  currentUserId?: string;
  onStatusChange: (taskId: string, status: PlanningTaskStatus) => void;
  onChanged?: () => void;
};

function formatDueDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short"
  }).format(parsed);
}

function getTodayIso(): string {
  const now = new Date();
  const aligned = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return aligned.toISOString().slice(0, 10);
}

function dueDateColour(dueDate: string): string {
  const today = getTodayIso();
  if (dueDate < today) return "text-[var(--color-danger)]";

  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const dueMs = new Date(`${dueDate}T00:00:00Z`).getTime();
  const diffDays = Math.round((dueMs - todayMs) / (1000 * 60 * 60 * 24));

  if (diffDays <= 7) return "text-[var(--color-warning)]";
  return "text-subtle";
}

function formatCompletedDate(completedAt: string | null): string {
  if (!completedAt) return "";
  const parsed = new Date(completedAt);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short"
  }).format(parsed);
}

export function SopTaskRow({ task, onStatusChange }: SopTaskRowProps) {
  const [isPending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);

  const isOpen = task.status === "open";
  const isDone = task.status === "done";
  const isNotRequired = task.status === "not_required";
  const isBlocked = isOpen && task.isBlocked;
  const isActionable = isOpen && !task.isBlocked;

  const assigneeNames = task.assignees.length > 0
    ? task.assignees.map((a) => a.name).join(", ")
    : task.assigneeName || "Unassigned";

  function handleStatusChange(status: PlanningTaskStatus): void {
    startTransition(() => {
      onStatusChange(task.id, status);
    });
  }

  function handleCheckboxClick(): void {
    if (isPending) return;
    if (isActionable) {
      handleStatusChange("done");
    } else if (isDone || isNotRequired) {
      handleStatusChange("open");
    }
  }

  // Determine row opacity and styling
  const rowOpacity = isDone ? "opacity-50" : isNotRequired ? "opacity-40" : isBlocked ? "opacity-60" : "";
  const titleStyle = isDone || isNotRequired ? "line-through text-subtle" : "font-medium text-[var(--color-text)]";

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-2.5 py-1.5",
        rowOpacity
      )}
    >
      {/* Checkbox area */}
      <button
        type="button"
        disabled={isPending || isBlocked}
        onClick={handleCheckboxClick}
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]",
          isActionable && "border-[var(--color-accent-cool-dark)] cursor-pointer hover:bg-[var(--color-accent-cool-dark)]/10",
          isBlocked && "border-gray-300 cursor-not-allowed bg-gray-50",
          isDone && "border-[#355849] bg-[var(--color-success)] cursor-pointer",
          isNotRequired && "border-gray-300 bg-gray-100 cursor-pointer"
        )}
        aria-label={
          isDone ? `Mark "${task.title}" as open`
          : isNotRequired ? `Mark "${task.title}" as open`
          : isActionable ? `Mark "${task.title}" as done`
          : `Task "${task.title}" is blocked`
        }
      >
        {isDone && <Check className="h-3.5 w-3.5 text-white" aria-hidden="true" />}
        {isNotRequired && <Minus className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />}
      </button>

      {/* Content area */}
      <div className="min-w-0 flex-1">
        <span className={cn("text-sm", titleStyle)}>{task.title}</span>

        {isBlocked && (
          <p className="mt-0.5 text-xs text-[var(--color-warning)]">
            Waiting on dependencies
          </p>
        )}

        {isDone && task.completedAt && (
          <p className="mt-0.5 text-xs text-subtle">
            Done {formatCompletedDate(task.completedAt)}
          </p>
        )}

        {isNotRequired && (
          <p className="mt-0.5 text-xs text-subtle">Not required</p>
        )}

        {!isDone && !isNotRequired && (
          <p className="mt-0.5 text-xs text-subtle">
            <span>{assigneeNames}</span>
            <span className="mx-1">&middot;</span>
            <span className={dueDateColour(task.dueDate)}>
              due {formatDueDate(task.dueDate)}
            </span>
          </p>
        )}
      </div>

      {/* Actions dropdown for "not required" option */}
      {isActionable && (
        <div className="relative shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="More actions"
            className="h-7 w-7 p-0"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
          {menuOpen && (
            <div
              className="absolute right-0 top-full z-10 mt-1 min-w-[160px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white py-1 shadow-soft"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-muted-surface)] transition-colors"
                onClick={() => {
                  setMenuOpen(false);
                  handleStatusChange("not_required");
                }}
              >
                Mark not required
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
