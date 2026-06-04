"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Minus, Pencil, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { reassignPlanningTaskAction, updatePlanningTaskAction } from "@/actions/planning";
import { getAttachmentUrlAction } from "@/actions/attachments";
import { AttachmentUploadButton } from "@/components/attachments/attachment-upload-button";
import { formatBytes } from "@/lib/attachments-types";
import type { PlanningPerson, PlanningTask, PlanningTaskStatus } from "@/lib/planning/types";

type SopTaskRowProps = {
  task: PlanningTask;
  allTasks: PlanningTask[];
  currentUserId?: string;
  users: PlanningPerson[];
  onStatusChange: (taskId: string, status: PlanningTaskStatus) => void;
  onChanged?: () => void;
  /** Shown appended to the "assignee · due date" subtitle, e.g. in
   * "Todos by person" where the task's parent isn't implicit. Omit when
   * rendered inside the parent item's own modal. */
  parentLabel?: { title: string; onOpen?: () => void };
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
  if (dueDate < today) return "text-[var(--burgundy)]";

  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const dueMs = new Date(`${dueDate}T00:00:00Z`).getTime();
  const diffDays = Math.round((dueMs - todayMs) / (1000 * 60 * 60 * 24));

  if (diffDays <= 7) return "text-[var(--mustard)]";
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

export function SopTaskRow({ task, allTasks, users, onStatusChange, onChanged, parentLabel }: SopTaskRowProps) {
  const [isPending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>(
    task.assignees.map((a) => a.id)
  );
  const [savingAssignees, setSavingAssignees] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Notes state — inline textarea below the row, toggled by the speech-bubble icon.
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(task.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const hasNotes = Boolean(task.notes && task.notes.trim().length);

  useEffect(() => {
    if (!notesOpen) {
      setNotesDraft(task.notes ?? "");
    }
  }, [notesOpen, task.notes]);

  const isOpen = task.status === "open";
  const isDone = task.status === "done";
  const isNotRequired = task.status === "not_required";
  const isBlocked = isOpen && task.isBlocked;
  const isActionable = isOpen && !task.isBlocked;

  const assigneeNames = task.assignees.length > 0
    ? task.assignees.map((a) => a.name).join(", ")
    : task.assigneeName || "Unassigned";

  // Close menu/reassign on outside click
  useEffect(() => {
    if (!menuOpen && !reassignOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setReassignOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen, reassignOpen]);

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

  function toggleAssignee(userId: string): void {
    setSelectedAssigneeIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  async function handleSaveAssignees(): Promise<void> {
    setSavingAssignees(true);
    const result = await reassignPlanningTaskAction({
      taskId: task.id,
      assigneeIds: selectedAssigneeIds,
    });
    setSavingAssignees(false);
    if (result.success) {
      toast.success("Task reassigned.");
      setReassignOpen(false);
      setMenuOpen(false);
      onChanged?.();
    } else {
      toast.error(result.message ?? "Could not reassign task.");
    }
  }

  async function handleSaveNotes(): Promise<void> {
    setSavingNotes(true);
    const trimmed = notesDraft.trim();
    const result = await updatePlanningTaskAction({
      taskId: task.id,
      notes: trimmed.length ? notesDraft : null
    });
    setSavingNotes(false);
    if (result.success) {
      toast.success("Notes saved.");
      setNotesOpen(false);
      onChanged?.();
    } else {
      toast.error(result.message ?? "Could not save notes.");
    }
  }

  // Only dim the row when the menu is closed — dropdown inherits parent opacity and becomes unreadable
  const rowOpacity = (menuOpen || reassignOpen)
    ? ""
    : isDone ? "opacity-50" : isNotRequired ? "opacity-40" : isBlocked ? "opacity-60" : "";
  const titleStyle = isDone || isNotRequired ? "line-through text-subtle" : "font-medium text-[var(--ink)]";

  return (
    <div
      className={cn(
        "rounded-[var(--radius-sm)] border border-[var(--hair)] bg-[var(--canvas-2)] px-2.5 py-1.5",
        rowOpacity
      )}
    >
    <div className="flex items-start gap-2.5">
      {/* Checkbox area */}
      <button
        type="button"
        disabled={isPending || isBlocked}
        onClick={handleCheckboxClick}
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--slate)]",
          isActionable && "border-[var(--slate)] cursor-pointer hover:bg-[var(--paper-tint)]",
          isBlocked && "border-gray-300 cursor-not-allowed bg-gray-50",
          isDone && "border-[var(--sage-dark)] bg-[var(--sage-dark)] cursor-pointer",
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
        <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className={cn(titleStyle)}>{task.title}</span>
          {notesOpen ? (
            <input
              type="text"
              autoFocus
              value={notesDraft}
              maxLength={500}
              disabled={savingNotes}
              placeholder="Add a short note (press Enter to save)"
              aria-label={`Edit notes for ${task.title}`}
              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--hair)] bg-[var(--paper)] px-2 py-0.5 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--mustard)]"
              onChange={(event) => setNotesDraft(event.target.value.replace(/[\r\n]+/g, " "))}
              onBlur={() => {
                // Save if dirty, otherwise just close.
                if (notesDraft !== (task.notes ?? "")) {
                  void handleSaveNotes();
                } else {
                  setNotesOpen(false);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSaveNotes();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setNotesOpen(false);
                  setNotesDraft(task.notes ?? "");
                }
              }}
            />
          ) : hasNotes ? (
            <span className="min-w-0 flex-1 truncate text-xs text-subtle">
              — {task.notes}
            </span>
          ) : null}
        </span>

        {isBlocked && (() => {
          const blockerNames = task.dependsOnTaskIds
            .map((depId) => {
              const dep = allTasks.find((t) => t.id === depId);
              return dep && dep.status === "open" ? dep.title : null;
            })
            .filter(Boolean);
          return (
            <p className="mt-0.5 text-xs text-[var(--mustard)]">
              Waiting on: {blockerNames.length > 0 ? blockerNames.join(", ") : "dependencies"}
            </p>
          );
        })()}

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
            {parentLabel ? (
              <>
                <span className="mx-1">&middot;</span>
                {parentLabel.onOpen ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      parentLabel.onOpen?.();
                    }}
                    className="font-medium text-[var(--navy)] hover:underline focus:outline-none focus-visible:underline"
                  >
                    {parentLabel.title}
                  </button>
                ) : (
                  <span className="font-medium text-[var(--ink)]">{parentLabel.title}</span>
                )}
              </>
            ) : null}
          </p>
        )}

        {task.attachments.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {task.attachments.map((attachment) => (
              <li key={attachment.id} className="flex items-center gap-1 text-[11px] text-subtle">
                <span aria-hidden="true">📎</span>
                <button
                  type="button"
                  onClick={async (event) => {
                    event.stopPropagation();
                    const result = await getAttachmentUrlAction({ attachmentId: attachment.id });
                    if (result.success) {
                      window.open(result.url, "_blank", "noopener,noreferrer");
                    }
                  }}
                  className="truncate text-left underline hover:text-[var(--navy)]"
                  title={attachment.filename}
                >
                  {attachment.filename}
                </button>
                <span className="flex-shrink-0">({formatBytes(attachment.sizeBytes)})</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Notes edit toggle — notes themselves render below the row persistently */}
      <button
        type="button"
        aria-label={hasNotes ? "Edit notes" : "Add notes"}
        aria-pressed={notesOpen}
        onClick={() => {
          if (notesOpen) {
            setNotesOpen(false);
            setNotesDraft(task.notes ?? "");
          } else {
            setNotesDraft(task.notes ?? "");
            setNotesOpen(true);
          }
        }}
        title={hasNotes ? "Edit notes" : "Add notes"}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-[var(--canvas-2)]"
      >
        <Pencil
          className={cn("h-4 w-4", hasNotes ? "text-[var(--navy)]" : "text-[var(--ink)]/70")}
          aria-hidden="true"
        />
      </button>

      {/* Attachments — quick file picker (compact icon matches other row controls) */}
      <AttachmentUploadButton
        parentType="planning_task"
        parentId={task.id}
        compact
        onUploaded={onChanged}
      />

      {/* Actions dropdown */}
      {(isActionable || isDone || isNotRequired) && (
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setMenuOpen(!menuOpen);
              setReassignOpen(false);
            }}
            aria-label="More actions"
            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--canvas-2)] disabled:opacity-60"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3" cy="8" r="1.5" fill="currentColor" />
              <circle cx="8" cy="8" r="1.5" fill="currentColor" />
              <circle cx="13" cy="8" r="1.5" fill="currentColor" />
            </svg>
          </button>

          {menuOpen && !reassignOpen && (
            <div
              className="absolute right-0 top-full z-10 mt-1 min-w-[180px] rounded-[var(--radius-sm)] border border-[var(--hair)] bg-[var(--paper)] py-1 shadow-card"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--ink)] transition-colors hover:bg-[var(--canvas-2)]"
                onClick={() => setReassignOpen(true)}
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span>Reassign</span>
              </button>
              {isActionable && (
                <button
                  type="button"
                  role="menuitem"
                  className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--ink)] transition-colors hover:bg-[var(--canvas-2)]"
                  onClick={() => {
                    setMenuOpen(false);
                    handleStatusChange("not_required");
                  }}
                >
                  <span aria-hidden="true" />
                  <span>Mark not required</span>
                </button>
              )}
              {isNotRequired && (
                <button
                  type="button"
                  role="menuitem"
                  className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--ink)] transition-colors hover:bg-[var(--canvas-2)]"
                  onClick={() => {
                    setMenuOpen(false);
                    handleStatusChange("open");
                  }}
                >
                  <span aria-hidden="true" />
                  <span>Mark required</span>
                </button>
              )}
              {isDone && (
                <button
                  type="button"
                  role="menuitem"
                  className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--ink)] transition-colors hover:bg-[var(--canvas-2)]"
                  onClick={() => {
                    setMenuOpen(false);
                    handleStatusChange("open");
                  }}
                >
                  <span aria-hidden="true" />
                  <span>Reopen</span>
                </button>
              )}
            </div>
          )}

          {reassignOpen && (
            <div
              className="absolute right-0 top-full z-10 mt-1 w-64 rounded-[var(--radius-sm)] border border-[var(--hair)] bg-[var(--paper)] shadow-card"
            >
              <div className="border-b border-[var(--hair)] px-3 py-2">
                <p className="text-xs font-medium text-[var(--ink)]">Assign to</p>
              </div>
              <div className="max-h-48 overflow-auto py-1">
                {users.map((user) => (
                  <label
                    key={user.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-[var(--canvas-2)] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAssigneeIds.includes(user.id)}
                      onChange={() => toggleAssignee(user.id)}
                      className="rounded border-[var(--hair)]"
                    />
                    <span className="text-[var(--ink)]">{user.name}</span>
                  </label>
                ))}
                {users.length === 0 && (
                  <p className="px-3 py-2 text-xs text-subtle">No users available.</p>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-[var(--hair)] px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setReassignOpen(false);
                    setSelectedAssigneeIds(task.assignees.map((a) => a.id));
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={savingAssignees}
                  onClick={() => void handleSaveAssignees()}
                >
                  {savingAssignees ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>

    </div>
  );
}
