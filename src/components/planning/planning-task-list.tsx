"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import {
  createPlanningTaskAction,
  deletePlanningTaskAction,
  togglePlanningTaskStatusAction,
  updatePlanningTaskAction
} from "@/actions/planning";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AttachmentUploadButton } from "@/components/attachments/attachment-upload-button";
import type { PlanningPerson, PlanningTask, PlanningTaskStatus } from "@/lib/planning/types";

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

  // Track which task has its notes expanded (only one at a time).
  const [expandedNotesTaskId, setExpandedNotesTaskId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string>("");

  useEffect(() => {
    if (!title.trim().length) {
      setAssigneeId(defaultAssigneeFromTasks(tasks));
    }
  }, [tasks, title]);

  function runTaskAction<T>(work: () => Promise<T>, successMessage?: string) {
    startTransition(async () => {
      const result: unknown = await work();
      if (result && typeof result === "object" && "success" in result) {
        if (!(result as { success: boolean }).success) {
          toast.error((result as { message?: string }).message ?? "Could not update task.");
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
          const isResolved = task.status === "done" || task.status === "not_required";
          const titleClass = isResolved ? "line-through text-subtle" : "font-medium";
          const notesExpanded = expandedNotesTaskId === task.id;
          const hasNotes = Boolean(task.notes && task.notes.trim().length);

          return (
            <li
              key={task.id}
              className={`rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-2.5 py-1.5 ${
                task.status === "not_required" ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-start gap-2 text-sm text-[var(--color-text)]">
                  <Select
                    aria-label={`Status for ${task.title}`}
                    value={task.status}
                    disabled={isPending}
                    className="mt-0.5 h-7 w-[9rem] py-0 text-xs"
                    onChange={(event) => {
                      const next = event.currentTarget.value as PlanningTaskStatus;
                      const message =
                        next === "done"
                          ? "Task completed."
                          : next === "not_required"
                            ? "Task marked not required."
                            : "Task reopened.";
                      runTaskAction(
                        () => togglePlanningTaskStatusAction({ taskId: task.id, status: next }),
                        message
                      );
                    }}
                  >
                    <option value="open">○ Open</option>
                    <option value="done">✓ Done</option>
                    <option value="not_required">— Not required</option>
                  </Select>
                  <span className="min-w-0">
                    <span className={titleClass}>{task.title}</span>
                    {task.status === "not_required" ? (
                      <span className="ml-1 text-[10px] italic text-subtle">(not required)</span>
                    ) : null}
                    <br />
                    <span className={`text-xs ${isOverdue ? "text-[var(--color-danger)]" : "text-subtle"}`}>
                      {task.assigneeName} · due {formatDueDate(task.dueDate)}
                    </span>
                  </span>
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={notesExpanded ? "Hide notes" : hasNotes ? "Show notes" : "Add notes"}
                    aria-pressed={notesExpanded}
                    disabled={isPending}
                    onClick={() => {
                      if (notesExpanded) {
                        setExpandedNotesTaskId(null);
                        setNotesDraft("");
                      } else {
                        setExpandedNotesTaskId(task.id);
                        setNotesDraft(task.notes ?? "");
                      }
                    }}
                    title={hasNotes ? "Notes" : "Add notes"}
                  >
                    <MessageSquare
                      className={`h-4 w-4 ${hasNotes ? "text-[var(--color-primary)]" : ""}`}
                      aria-hidden="true"
                    />
                  </Button>
                  <AttachmentUploadButton
                    parentType="planning_task"
                    parentId={task.id}
                    compact
                    onUploaded={onChanged}
                  />
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
              </div>

              {notesExpanded ? (
                <div className="mt-2 space-y-1.5">
                  <textarea
                    className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
                    rows={4}
                    maxLength={10_000}
                    placeholder="Add any context, links, or reminders for this task"
                    value={notesDraft}
                    disabled={isPending}
                    onChange={(event) => setNotesDraft(event.target.value)}
                  />
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => {
                        setExpandedNotesTaskId(null);
                        setNotesDraft("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={isPending || notesDraft === (task.notes ?? "")}
                      onClick={() =>
                        runTaskAction(
                          () =>
                            updatePlanningTaskAction({
                              taskId: task.id,
                              notes: notesDraft.trim().length ? notesDraft : null
                            }),
                          "Notes saved."
                        )
                      }
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : hasNotes ? (
                <p className="mt-1.5 whitespace-pre-wrap break-words text-xs text-subtle">{task.notes}</p>
              ) : null}
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
