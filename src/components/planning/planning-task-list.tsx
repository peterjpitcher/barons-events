"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import {
  createPlanningTaskAction,
  deletePlanningTaskAction,
  togglePlanningTaskStatusAction
} from "@/actions/planning";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { PlanningPerson, PlanningTask } from "@/lib/planning/types";

type PlanningTaskListProps = {
  itemId: string;
  tasks: PlanningTask[];
  users: PlanningPerson[];
  onChanged: () => void;
};

function formatDueDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(parsed);
}

function inputDateToday(): string {
  const now = new Date();
  const localMidnightAligned = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localMidnightAligned.toISOString().slice(0, 10);
}

function defaultAssigneeFromTasks(tasks: PlanningTask[]): string {
  if (!tasks.length) return "";

  const latest = [...tasks].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return right.sortOrder - left.sortOrder;
    if (left.dueDate !== right.dueDate) return right.dueDate.localeCompare(left.dueDate);
    return right.title.localeCompare(left.title);
  })[0];

  return latest?.assigneeId ?? "";
}

export function PlanningTaskList({ itemId, tasks, users, onChanged }: PlanningTaskListProps) {
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState(() => defaultAssigneeFromTasks(tasks));
  const [dueDate, setDueDate] = useState(() => inputDateToday());
  const [isPending, startTransition] = useTransition();

  const sortedUsers = useMemo(
    () => [...users].sort((left, right) => left.name.localeCompare(right.name)),
    [users]
  );

  const sortedTasks = useMemo(
    () =>
      [...tasks].sort((left, right) => {
        if (left.status !== right.status) return left.status === "open" ? -1 : 1;
        if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
        if (left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate);
        return left.title.localeCompare(right.title);
      }),
    [tasks]
  );

  useEffect(() => {
    if (!title.trim().length) {
      setAssigneeId(defaultAssigneeFromTasks(tasks));
    }
  }, [tasks, title]);

  function runTaskAction<T>(work: () => Promise<T>, successMessage?: string) {
    startTransition(async () => {
      const result: any = await work();
      if (result && typeof result === "object" && "success" in result) {
        if (!result.success) {
          toast.error(result.message ?? "Could not update task.");
          return;
        }
      }

      if (successMessage) {
        toast.success(successMessage);
      }
      onChanged();
    });
  }

  function handleCreateTask() {
    if (!title.trim().length || !dueDate) {
      toast.error("Add task title and due date.");
      return;
    }

    runTaskAction(
      () =>
        createPlanningTaskAction({
          planningItemId: itemId,
          title,
          assigneeId,
          dueDate,
          sortOrder: tasks.length
        }),
      "Task added."
    );

    setTitle("");
    setDueDate(inputDateToday());
  }

  return (
    <section className="space-y-2 border-t border-[var(--color-border)] pt-2">
      <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle">Todo list</h4>
      <ul className="space-y-1.5">
        {sortedTasks.map((task) => {
          const isOverdue = task.status === "open" && task.dueDate < new Date().toISOString().slice(0, 10);
          return (
            <li
              key={task.id}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-2.5 py-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <label className="flex items-start gap-2 text-sm text-[var(--color-text)]">
                  <input
                    type="checkbox"
                    checked={task.status === "done"}
                    disabled={isPending}
                    className="mt-1 h-4 w-4"
                    onChange={(event) =>
                      runTaskAction(
                        () =>
                          togglePlanningTaskStatusAction({
                            taskId: task.id,
                            status: event.currentTarget.checked ? "done" : "open"
                          }),
                        event.currentTarget.checked ? "Task completed." : "Task reopened."
                      )
                    }
                  />
                  <span>
                    <span className={task.status === "done" ? "line-through text-subtle" : "font-medium"}>
                      {task.title}
                    </span>
                    <br />
                    <span className={`text-xs ${isOverdue ? "text-[var(--color-danger)]" : "text-subtle"}`}>
                      {task.assigneeName} · due {formatDueDate(task.dueDate)}
                    </span>
                  </span>
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => runTaskAction(() => deletePlanningTaskAction({ taskId: task.id }), "Task removed.")}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="grid gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] p-1.5 md:grid-cols-[minmax(0,1fr)_180px_170px_auto]">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add task"
          maxLength={160}
          disabled={isPending}
        />
        <Select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} disabled={isPending}>
          <option value="">To be determined</option>
          {sortedUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          disabled={isPending}
        />
        <Button type="button" onClick={handleCreateTask} disabled={isPending}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add
        </Button>
      </div>
    </section>
  );
}
