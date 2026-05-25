"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Link2, Plus, Trash2, Pencil, X } from "lucide-react";
import {
  createPlanningTaskAction,
  createPlanningTaskDependencyAction,
  deletePlanningTaskDependencyAction,
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
          const isBlocked = task.status === "open" && task.isBlocked;
          const titleClass = isResolved ? "line-through text-subtle" : "font-medium";
          const notesExpanded = expandedNotesTaskId === task.id;
          const hasNotes = Boolean(task.notes && task.notes.trim().length);
          const dependencyTasks = task.dependsOnTaskIds
            .map((dependencyId) => sortedTasks.find((candidate) => candidate.id === dependencyId))
            .filter((candidate): candidate is PlanningTask => Boolean(candidate));
          const openDependencyNames = dependencyTasks
            .filter((dependency) => dependency.status === "open")
            .map((dependency) => dependency.title);
          const dependencyOptions = sortedTasks.filter(
            (candidate) => candidate.id !== task.id && !task.dependsOnTaskIds.includes(candidate.id)
          );

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
                    disabled={isPending || isBlocked}
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
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className={titleClass}>{task.title}</span>
                      {task.status === "not_required" ? (
                        <span className="text-[10px] italic text-subtle">(not required)</span>
                      ) : null}
                      {notesExpanded ? (
                        <input
                          type="text"
                          autoFocus
                          value={notesDraft}
                          maxLength={500}
                          disabled={isPending}
                          placeholder="Add a short note (press Enter to save)"
                          aria-label={`Edit notes for ${task.title}`}
                          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
                          onChange={(event) =>
                            setNotesDraft(event.target.value.replace(/[\r\n]+/g, " "))
                          }
                          onBlur={() => {
                            if (notesDraft !== (task.notes ?? "")) {
                              runTaskAction(
                                () =>
                                  updatePlanningTaskAction({
                                    taskId: task.id,
                                    notes: notesDraft.trim().length ? notesDraft : null
                                  }),
                                "Notes saved."
                              );
                            }
                            setExpandedNotesTaskId(null);
                            setNotesDraft("");
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              runTaskAction(
                                () =>
                                  updatePlanningTaskAction({
                                    taskId: task.id,
                                    notes: notesDraft.trim().length ? notesDraft : null
                                  }),
                                "Notes saved."
                              );
                              setExpandedNotesTaskId(null);
                              setNotesDraft("");
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              setExpandedNotesTaskId(null);
                              setNotesDraft("");
                            }
                          }}
                        />
                      ) : hasNotes ? (
                        <span className="min-w-0 flex-1 truncate text-xs text-subtle">— {task.notes}</span>
                      ) : null}
                    </span>
                    <span className={`block text-xs ${isOverdue ? "text-[var(--color-danger)]" : "text-subtle"}`}>
                      {task.assigneeName} · due {formatDueDate(task.dueDate)}
                    </span>
                    {isBlocked ? (
                      <span className="mt-0.5 block text-xs text-[var(--color-warning)]">
                        Waiting on: {openDependencyNames.length ? openDependencyNames.join(", ") : "dependencies"}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={hasNotes ? "Edit notes" : "Add notes"}
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
                    title={hasNotes ? "Edit notes" : "Add notes"}
                  >
                    <Pencil
                      className={`h-4 w-4 ${hasNotes ? "text-[var(--color-primary-700)]" : ""}`}
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

              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs md:pl-[calc(9rem+0.5rem)]">
                {dependencyTasks.length > 0 ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-subtle">
                      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Depends on
                    </span>
                    {dependencyTasks.map((dependency) => (
                      <span
                        key={dependency.id}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[11px] text-[var(--color-text)]"
                      >
                        <span className="truncate">{dependency.title}</span>
                        <button
                          type="button"
                          disabled={isPending}
                          aria-label={`Remove dependency on ${dependency.title}`}
                          title="Remove dependency"
                          className="rounded-full p-0.5 text-subtle hover:bg-[var(--color-muted-surface)] hover:text-[var(--color-text)] disabled:opacity-50"
                          onClick={() =>
                            runTaskAction(
                              () =>
                                deletePlanningTaskDependencyAction({
                                  taskId: task.id,
                                  dependsOnTaskId: dependency.id
                                }),
                              "Dependency removed."
                            )
                          }
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                  </>
                ) : null}
                {dependencyOptions.length > 0 ? (
                  <Select
                    aria-label={`Add dependency for ${task.title}`}
                    value=""
                    disabled={isPending}
                    className="h-7 w-full max-w-[15rem] py-0 text-xs md:w-[15rem]"
                    onChange={(event) => {
                      const dependsOnTaskId = event.currentTarget.value;
                      if (!dependsOnTaskId) return;
                      runTaskAction(
                        () =>
                          createPlanningTaskDependencyAction({
                            taskId: task.id,
                            dependsOnTaskId
                          }),
                        "Dependency added."
                      );
                    }}
                  >
                    <option value="">Add dependency</option>
                    {dependencyOptions.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.title}
                      </option>
                    ))}
                  </Select>
                ) : null}
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
