"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Calendar, Check, ClipboardList, GripVertical, Pencil, Trash2, X } from "lucide-react";
import { ApproveEventButton } from "@/components/events/approve-event-button";
import { convertInspirationItemAction, deletePlanningItemAction, dismissInspirationItemAction, updatePlanningItemAction } from "@/actions/planning";
import { PlanningTaskList } from "@/components/planning/planning-task-list";
import { SopChecklistView } from "@/components/planning/sop-checklist-view";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PlanningEventOverlay, PlanningInspirationItem, PlanningItem, PlanningPerson, PlanningTask, PlanningVenueOption } from "@/lib/planning/types";
import { formatDate } from "@/lib/utils/format";

type PlanningItemCardProps = {
  item: PlanningItem;
  users: PlanningPerson[];
  venues?: PlanningVenueOption[];
  onChanged: () => void;
  onDragStart?: (item: PlanningItem) => void;
  compact?: boolean;
  onOpenDetails?: (item: PlanningItem) => void;
};

type EditableField = "title" | "typeLabel" | "status" | "targetDate" | "ownerId" | "venueId" | "description";

const STATUS_OPTIONS: Array<{ value: PlanningItem["status"]; label: string }> = [
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" }
];

const STATUS_BADGE_VARIANT: Record<PlanningItem["status"], "neutral" | "info" | "warning" | "success" | "danger"> = {
  planned: "neutral",
  in_progress: "info",
  blocked: "warning",
  done: "success",
  cancelled: "danger"
};

function formatStatus(value: PlanningItem["status"]): string {
  return value.replace(/_/g, " ");
}

type TaskProgressBarProps = {
  tasks: PlanningTask[];
};

function TaskProgressBar({ tasks }: TaskProgressBarProps) {
  const total = tasks.length;
  const resolved = tasks.filter((t) => t.status === "done" || t.status === "not_required").length;
  const pct = total > 0 ? Math.round((resolved / total) * 100) : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-subtle">
          Tasks: {resolved}/{total}
        </p>
        <p className="text-xs font-medium text-[var(--color-text)]">{pct}%</p>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-muted-surface)]">
        <div
          className="h-full rounded-full bg-[var(--color-primary-400)] transition-[width]"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${resolved} of ${total} tasks resolved`}
        />
      </div>
    </div>
  );
}

export function PlanningItemCard({
  item,
  users,
  venues = [],
  onChanged,
  onDragStart,
  compact = false,
  onOpenDetails
}: PlanningItemCardProps) {
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [title, setTitle] = useState(item.title);
  const [typeLabel, setTypeLabel] = useState(item.typeLabel);
  const [description, setDescription] = useState(item.description ?? "");
  const [ownerId, setOwnerId] = useState(item.ownerId ?? "");
  const [venueId, setVenueId] = useState(item.venueId ?? "");
  const [status, setStatus] = useState<PlanningItem["status"]>(item.status);
  const [targetDate, setTargetDate] = useState(item.targetDate);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleCompactStatusChange(newStatus: PlanningItem["status"]) {
    setStatus(newStatus);
    startTransition(async () => {
      const result: unknown = await updatePlanningItemAction({
        itemId: item.id,
        status: newStatus,
      });
      if (result && typeof result === "object" && "success" in result && !(result as { success: boolean }).success) {
        toast.error((result as { message?: string }).message ?? "Could not update status.");
        setStatus(item.status);
        return;
      }
      toast.success("Status updated.");
      onChanged();
    });
  }

  useEffect(() => {
    setTitle(item.title);
    setTypeLabel(item.typeLabel);
    setDescription(item.description ?? "");
    setOwnerId(item.ownerId ?? "");
    setVenueId(item.venueId ?? "");
    setStatus(item.status);
    setTargetDate(item.targetDate);
    setConfirmDelete(false);
    setEditingField(null);
  }, [item]);

  function runAction<T>(work: () => Promise<T>, successMessage: string, onSuccess?: () => void) {
    startTransition(async () => {
      const result: unknown = await work();
      if (result && typeof result === "object" && "success" in result && !(result as { success: boolean }).success) {
        toast.error((result as { message?: string }).message ?? "Could not update planning item.");
        return;
      }
      toast.success(successMessage);
      onSuccess?.();
      onChanged();
    });
  }

  function saveField(field: EditableField) {
    if (field === "title") {
      const nextTitle = title.trim();
      if (!nextTitle.length) {
        toast.error("Title is required.");
        return;
      }
      setTitle(nextTitle);
      runAction(
        () =>
          updatePlanningItemAction({
            itemId: item.id,
            title: nextTitle
          }),
        "Title updated.",
        () => setEditingField(null)
      );
      return;
    }

    if (field === "typeLabel") {
      const nextType = typeLabel.trim();
      if (!nextType.length) {
        toast.error("Planning type is required.");
        return;
      }
      setTypeLabel(nextType);
      runAction(
        () =>
          updatePlanningItemAction({
            itemId: item.id,
            typeLabel: nextType
          }),
        "Planning type updated.",
        () => setEditingField(null)
      );
      return;
    }

    if (field === "status") {
      runAction(
        () =>
          updatePlanningItemAction({
            itemId: item.id,
            status
          }),
        "Status updated.",
        () => setEditingField(null)
      );
      return;
    }

    if (field === "targetDate") {
      if (!targetDate) {
        toast.error("Target date is required.");
        return;
      }
      runAction(
        () =>
          updatePlanningItemAction({
            itemId: item.id,
            targetDate
          }),
        "Target date updated.",
        () => setEditingField(null)
      );
      return;
    }

    if (field === "ownerId") {
      runAction(
        () =>
          updatePlanningItemAction({
            itemId: item.id,
            ownerId
          }),
        "Owner updated.",
        () => setEditingField(null)
      );
      return;
    }

    if (field === "venueId") {
      runAction(
        () =>
          updatePlanningItemAction({
            itemId: item.id,
            venueId
          }),
        "Venue updated.",
        () => setEditingField(null)
      );
      return;
    }

    if (field === "description") {
      runAction(
        () =>
          updatePlanningItemAction({
            itemId: item.id,
            description
          }),
        "Description updated.",
        () => setEditingField(null)
      );
    }
  }

  function cancelField(field: EditableField) {
    if (field === "title") {
      setTitle(item.title);
    } else if (field === "typeLabel") {
      setTypeLabel(item.typeLabel);
    } else if (field === "status") {
      setStatus(item.status);
    } else if (field === "targetDate") {
      setTargetDate(item.targetDate);
    } else if (field === "ownerId") {
      setOwnerId(item.ownerId ?? "");
    } else if (field === "venueId") {
      setVenueId(item.venueId ?? "");
    } else if (field === "description") {
      setDescription(item.description ?? "");
    }
    setEditingField(null);
  }

  function InlineFieldActions({ field }: { field: EditableField }) {
    return (
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={isPending}
          onClick={() => saveField(field)}
          aria-label={`Save ${field}`}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={isPending}
          onClick={() => cancelField(field)}
          aria-label={`Cancel ${field}`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  const isDone = status === "done" || status === "cancelled";
  const canDrag = typeof onDragStart === "function";
  const ownerName = users.find((user) => user.id === ownerId)?.name ?? "Unassigned";
  const venueName = venues.find((venue) => venue.id === venueId)?.name ?? "Global";

  if (compact) {
    return (
      <article
        draggable={canDrag}
        onDragStart={canDrag ? () => onDragStart(item) : undefined}
        aria-label={`Planning item: ${item.title}`}
        className="space-y-2 rounded-[var(--radius)] border border-[var(--color-border)] border-l-4 border-l-[var(--color-primary-400)] bg-white p-2.5 shadow-soft"
      >
        <header className="flex items-start justify-between gap-1.5">
          <div className="space-y-0.5">
            <p className="flex items-center gap-1 text-xs uppercase tracking-[0.08em] text-subtle">
              {canDrag ? <GripVertical className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
              Planning item
            </p>
            <h3 className="text-base font-semibold text-[var(--color-text)]">{item.title}</h3>
            <p className="text-xs text-subtle">{item.typeLabel}</p>
          </div>
          <select
            value={status}
            disabled={isPending}
            onChange={(e) => handleCompactStatusChange(e.target.value as PlanningItem["status"])}
            aria-label="Change status"
            className={cn(
              "cursor-pointer appearance-none rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)] disabled:cursor-not-allowed disabled:opacity-60",
              status === "planned" && "border border-[var(--color-primary-400)] bg-[var(--color-primary-100)] text-[var(--color-primary-900)]",
              status === "in_progress" && "border border-[var(--color-accent-cool-dark)] bg-[var(--color-info)] text-white",
              status === "blocked" && "border border-[#9a6d2b] bg-[var(--color-warning)] text-[#2f230d]",
              status === "done" && "border border-[#355849] bg-[var(--color-success)] text-white",
              status === "cancelled" && "border border-[#6e3032] bg-[var(--color-danger)] text-white"
            )}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </header>

        <div className="grid gap-1.5 text-xs text-subtle md:grid-cols-2">
          <p>
            <span className="font-semibold text-[var(--color-text)]">Target:</span> {formatDate(item.targetDate)}
          </p>
          <p>
            <span className="font-semibold text-[var(--color-text)]">Owner:</span> {item.ownerName ?? "Unassigned"}
          </p>
          <p>
            <span className="font-semibold text-[var(--color-text)]">Venue:</span> {item.venueName ?? "Global"}
          </p>
          <p>
            <span className="font-semibold text-[var(--color-text)]">Recurring:</span> {item.seriesId ? "Yes" : "No"}
            {item.isException ? " (exception)" : ""}
          </p>
        </div>

        {item.description ? <p className="text-sm text-[var(--color-text)]">{item.description}</p> : null}

        {item.tasks.length > 0 ? (
          <TaskProgressBar tasks={item.tasks} />
        ) : null}

        {onOpenDetails ? (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button type="button" size="sm" variant="subtle" onClick={() => onOpenDetails(item)}>
              <Pencil className="mr-1 h-4 w-4" aria-hidden="true" /> Manage
            </Button>
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <article
      draggable={canDrag}
      onDragStart={canDrag ? () => onDragStart(item) : undefined}
      aria-label={`Planning item: ${title}`}
      className="space-y-2 rounded-[var(--radius)] border border-[var(--color-border)] border-l-4 border-l-[var(--color-primary-400)] bg-white p-2.5 shadow-soft"
    >
      <header className="flex items-start justify-between gap-1.5">
        <div className="space-y-0.5">
          <p className="flex items-center gap-1 text-xs uppercase tracking-[0.08em] text-subtle">
            {canDrag ? <GripVertical className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
            Planning item
          </p>
          {editingField === "title" ? (
            <div className="flex items-center gap-2">
              <Input value={title} maxLength={160} disabled={isPending} onChange={(event) => setTitle(event.target.value)} />
              <InlineFieldActions field="title" />
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <h3 className="text-base font-semibold text-[var(--color-text)]">{title}</h3>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                disabled={isPending}
                onClick={() => setEditingField("title")}
                aria-label="Edit title"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}

          {editingField === "typeLabel" ? (
            <div className="flex items-center gap-2">
              <Input value={typeLabel} maxLength={120} disabled={isPending} onChange={(event) => setTypeLabel(event.target.value)} />
              <InlineFieldActions field="typeLabel" />
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <p className="text-xs text-subtle">{typeLabel}</p>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                disabled={isPending}
                onClick={() => setEditingField("typeLabel")}
                aria-label="Edit planning type"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
        {editingField === "status" ? (
          <div className="flex items-center gap-2">
            <Select value={status} disabled={isPending} onChange={(event) => setStatus(event.target.value as PlanningItem["status"])}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <InlineFieldActions field="status" />
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Badge variant={STATUS_BADGE_VARIANT[status]}>{formatStatus(status)}</Badge>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              disabled={isPending}
              onClick={() => setEditingField("status")}
              aria-label="Edit status"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        )}
      </header>

      <div className="grid gap-1.5 md:grid-cols-2">
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1.5 text-xs text-subtle">
          <p className="font-semibold text-[var(--color-text)]">Target</p>
          {editingField === "targetDate" ? (
            <div className="mt-0.5 flex items-center gap-1.5">
              <Input type="date" value={targetDate} disabled={isPending} onChange={(event) => setTargetDate(event.target.value)} />
              <InlineFieldActions field="targetDate" />
            </div>
          ) : (
            <div className="mt-0.5 flex items-center gap-1">
              <span>{formatDate(targetDate)}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                disabled={isPending || isDone}
                onClick={() => setEditingField("targetDate")}
                aria-label="Edit target date"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>

        <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1.5 text-xs text-subtle">
          <p className="font-semibold text-[var(--color-text)]">Owner</p>
          {editingField === "ownerId" ? (
            <div className="mt-0.5 flex items-center gap-1.5">
              <Select value={ownerId} disabled={isPending} onChange={(event) => setOwnerId(event.target.value)}>
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
              <InlineFieldActions field="ownerId" />
            </div>
          ) : (
            <div className="mt-0.5 flex items-center gap-1">
              <span>{ownerName}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                disabled={isPending}
                onClick={() => setEditingField("ownerId")}
                aria-label="Edit owner"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>

        <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1.5 text-xs text-subtle">
          <p className="font-semibold text-[var(--color-text)]">Venue</p>
          {editingField === "venueId" ? (
            <div className="mt-0.5 flex items-center gap-1.5">
              <Select value={venueId} disabled={isPending} onChange={(event) => setVenueId(event.target.value)}>
                <option value="">Global</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}
                  </option>
                ))}
              </Select>
              <InlineFieldActions field="venueId" />
            </div>
          ) : (
            <div className="mt-0.5 flex items-center gap-1">
              <span>{venueName}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                disabled={isPending}
                onClick={() => setEditingField("venueId")}
                aria-label="Edit venue"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>

        <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1.5 text-xs text-subtle">
          <p className="font-semibold text-[var(--color-text)]">Recurring</p>
          <p className="mt-0.5">
            {item.seriesId ? "Yes" : "No"}
            {item.isException ? " (exception)" : ""}
          </p>
        </div>
      </div>

      <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1.5">
        <p className="text-xs font-semibold text-[var(--color-text)]">Description</p>
        {editingField === "description" ? (
          <div className="mt-0.5 flex items-start gap-1.5">
            <Textarea
              value={description}
              rows={3}
              maxLength={2000}
              disabled={isPending}
              placeholder="Optional description"
              onChange={(event) => setDescription(event.target.value)}
            />
            <InlineFieldActions field="description" />
          </div>
        ) : (
          <div className="mt-0.5 flex items-start gap-1">
            <p className="text-sm text-[var(--color-text)]">{description.trim().length ? description : "No description"}</p>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              disabled={isPending}
              onClick={() => setEditingField("description")}
              aria-label="Edit description"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="ml-auto flex items-center gap-1.5">
          {confirmDelete ? (
            <>
              <p className="text-xs font-medium text-[var(--color-danger)]">Confirm delete?</p>
              <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={isPending}
                onClick={() =>
                  runAction(
                    () => deletePlanningItemAction({ itemId: item.id }),
                    "Planning item deleted.",
                    () => setConfirmDelete(false)
                  )
                }
              >
                <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" /> Confirm delete
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="destructive" disabled={isPending} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" /> Delete
            </Button>
          )}
        </div>
      </div>

      {(() => {
        const sopTasks = item.tasks.filter((t) => t.sopSection !== null);
        const regularTasks = item.tasks.filter((t) => t.sopSection === null);
        return (
          <>
            {sopTasks.length > 0 && (
              <SopChecklistView
                tasks={sopTasks}
                users={users}
                itemId={item.id}
                onChanged={onChanged}
              />
            )}
            {regularTasks.length > 0 && (
              <PlanningTaskList itemId={item.id} tasks={regularTasks} users={users} onChanged={onChanged} />
            )}
            {sopTasks.length === 0 && regularTasks.length === 0 && (
              <PlanningTaskList itemId={item.id} tasks={[]} users={users} onChanged={onChanged} />
            )}
          </>
        );
      })()}
    </article>
  );
}

const CATEGORY_LABELS: Record<PlanningInspirationItem['category'], string> = {
  bank_holiday: 'Bank Holiday',
  seasonal: 'Seasonal',
  floating: 'Occasion',
  sporting: 'Sporting',
};

export function InspirationItemCard({ item }: { item: PlanningInspirationItem }) {
  const [converting, setConverting] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  async function handleConvert() {
    setConverting(true);
    const result = await convertInspirationItemAction(item.id);
    if (!result.success) {
      toast.error(result.message ?? 'Failed to add to plan.');
    }
    setConverting(false);
  }

  async function handleDismiss() {
    setDismissing(true);
    const result = await dismissInspirationItemAction(item.id);
    if (!result.success) {
      toast.error(result.message ?? 'Failed to hide item.');
    }
    setDismissing(false);
  }

  // Format the date as "Fri 14 Feb" using London timezone
  const formattedDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${item.eventDate}T12:00:00Z`));

  return (
    <div className="rounded-md border-2 border-dashed border-amber-400 bg-amber-50 px-3 py-2 flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm">✨</span>
          <span className="text-sm font-medium text-amber-900 truncate">{item.eventName}</span>
          <span className="text-xs text-amber-600 bg-amber-100 rounded px-1.5 py-0.5 shrink-0">
            {CATEGORY_LABELS[item.category]}
          </span>
        </div>
        <p className="text-xs text-amber-700 mt-0.5">{formattedDate}</p>
        {item.description && (
          <p className="text-xs text-amber-600 mt-0.5 truncate">{item.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={converting || dismissing}
          onClick={handleConvert}
          className="bg-amber-500 hover:bg-amber-600 text-white"
        >
          {converting ? '…' : 'Add to plan'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={converting || dismissing}
          onClick={handleDismiss}
        >
          {dismissing ? '…' : 'Hide'}
        </Button>
      </div>
    </div>
  );
}

type EventOverlayCardProps = {
  event: PlanningEventOverlay;
  canApprove?: boolean;
};

const EVENT_STATUS_BADGE_VARIANT: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  submitted: "info",
  needs_revisions: "warning",
  approved: "success",
  completed: "success",
  rejected: "danger",
};

export function EventOverlayCard({ event, canApprove }: EventOverlayCardProps) {
  const statusTone = EVENT_STATUS_BADGE_VARIANT[event.status] ?? "neutral";
  const hasWebCopy = Boolean(event.publicTitle);

  return (
    <article aria-label={`Event: ${event.publicTitle ?? event.title}`} className="space-y-2 rounded-[var(--radius)] border border-[var(--color-border)] border-l-4 border-l-[var(--color-accent-cool-dark)] bg-white p-2.5 shadow-soft">
      <header className="flex items-start justify-between gap-1.5">
        <div className="space-y-0.5">
          <p className="flex items-center gap-1 text-xs uppercase tracking-[0.08em] text-subtle">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            Event
          </p>
          <h3 className="text-base font-semibold text-[var(--color-text)]">{event.publicTitle ?? event.title}</h3>
          {event.publicTeaser && (
            <p className="text-xs text-subtle">{event.publicTeaser}</p>
          )}
        </div>
        <Badge variant={statusTone}>{event.status.replace(/_/g, " ")}</Badge>
      </header>

      <div className="grid gap-1.5 text-xs text-subtle md:grid-cols-2">
        <p>
          <span className="font-semibold text-[var(--color-text)]">Date:</span>{" "}
          {new Date(event.startAt).toLocaleString("en-GB", {
            timeZone: "Europe/London",
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        <p>
          <span className="font-semibold text-[var(--color-text)]">Venue:</span>{" "}
          {event.venueName ?? "Unknown venue"}
          {event.venueSpace ? ` · ${event.venueSpace}` : ""}
        </p>
        <p>
          <span className="font-semibold text-[var(--color-text)]">Web copy:</span>{" "}
          {hasWebCopy ? "Ready" : "Not yet"}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {canApprove && ["submitted", "draft"].includes(event.status) ? (
          <ApproveEventButton eventId={event.eventId} size="sm" className="h-auto px-3 py-1 text-xs" hasWebCopy={hasWebCopy} />
        ) : null}
        <Link href={`/events/${event.eventId}`}>
          <Button type="button" size="sm" variant="subtle">
            <Pencil className="mr-1 h-4 w-4" aria-hidden="true" /> Manage
          </Button>
        </Link>
      </div>
    </article>
  );
}
