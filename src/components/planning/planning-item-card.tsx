"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Calendar, Check, ChevronDown, ClipboardList, GripVertical, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { ApproveEventButton } from "@/components/events/approve-event-button";
import { StatusDropdown } from "@/components/events/status-dropdown";
import { CancelEventDialog } from "@/components/events/cancel-event-dialog";
import { archiveDraftEventAction, updateEventStatusAction } from "@/actions/events";
import {
  convertInspirationItemAction,
  deletePlanningItemAction,
  dismissInspirationItemAction,
  updatePlanningItemAction
} from "@/actions/planning";
import { PlanningTaskList } from "@/components/planning/planning-task-list";
import { SopChecklistView } from "@/components/planning/sop-checklist-view";
import { VenueMultiSelect, type VenueOption } from "@/components/venues/venue-multi-select";
import { Badge } from "@/components/ui/badge";
import { Avatar, ProgressRing, SLAChip } from "@/components/ui/design-primitives";
import { FieldLabel } from "@/components/ui/field-label";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CalendarNote } from "@/lib/calendar-notes";
import type { PlanningEventOverlay, PlanningInspirationItem, PlanningItem, PlanningPerson, PlanningTask, PlanningVenueOption } from "@/lib/planning/types";
import { deriveInitialVenueIds } from "@/lib/planning/utils";
import { formatDate } from "@/lib/utils/format";

type PlanningItemCardProps = {
  item: PlanningItem;
  users: PlanningPerson[];
  venues?: PlanningVenueOption[];
  onChanged: () => void;
  onDragStart?: (item: PlanningItem) => void;
  compact?: boolean;
  onOpenDetails?: (item: PlanningItem) => void;
  currentUserId?: string;
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

function getStatusLabel(value: PlanningItem["status"]): string {
  return STATUS_OPTIONS.find((option) => option.value === value)?.label ?? formatStatus(value);
}

type TaskProgressBarProps = {
  tasks: PlanningTask[];
};

function TaskProgressBar({ tasks }: TaskProgressBarProps) {
  const { total, resolved, pct } = getTaskProgress(tasks);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-subtle">
          Tasks: {resolved}/{total}
        </p>
        <p className="text-xs font-medium text-[var(--ink)]">{pct}%</p>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--canvas-2)]">
        <div
          className="h-full rounded-full bg-[var(--slate)] transition-[width]"
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

function getTaskProgress(tasks: PlanningTask[]): { total: number; resolved: number; pct: number } {
  const total = tasks.length;
  const resolved = tasks.filter((task) => task.status === "done" || task.status === "not_required").length;
  return {
    total,
    resolved,
    pct: total > 0 ? Math.round((resolved / total) * 100) : 0,
  };
}

export function PlanningItemCard({
  item,
  users,
  venues = [],
  onChanged,
  onDragStart,
  compact = false,
  onOpenDetails,
  currentUserId
}: PlanningItemCardProps) {
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [title, setTitle] = useState(item.title);
  const [typeLabel, setTypeLabel] = useState(item.typeLabel);
  const [description, setDescription] = useState(item.description ?? "");
  const [ownerId, setOwnerId] = useState(item.ownerId ?? "");
  const [venueId, setVenueId] = useState(item.venueId ?? "");
  // Hydrate from the full venue list via the shared helper — see
  // issue-log 2026-04-18 item 03 for why `item.venueId` alone would silently
  // drop the extra venues on save.
  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>(() => deriveInitialVenueIds(item));
  const [status, setStatus] = useState<PlanningItem["status"]>(item.status);
  const [targetDate, setTargetDate] = useState(item.targetDate);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [compactStatusOpen, setCompactStatusOpen] = useState(false);
  const compactStatusRef = useRef<HTMLDivElement>(null);
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
    if (!compactStatusOpen) return;

    function handlePointerDown(event: MouseEvent): void {
      if (!compactStatusRef.current?.contains(event.target as Node)) {
        setCompactStatusOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setCompactStatusOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [compactStatusOpen]);

  useEffect(() => {
    setTitle(item.title);
    setTypeLabel(item.typeLabel);
    setDescription(item.description ?? "");
    setOwnerId(item.ownerId ?? "");
    setVenueId(item.venueId ?? "");
    setSelectedVenueIds(deriveInitialVenueIds(item));
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
      // One planning item, multiple venues. Empty array makes the item global.
      const ids = selectedVenueIds;
      runAction(
        () =>
          updatePlanningItemAction({
            itemId: item.id,
            venueIds: ids
          }),
        ids.length === 0
          ? "Moved to global."
          : ids.length === 1
            ? "Venue updated."
            : `Linked to ${ids.length} venues.`,
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
      setSelectedVenueIds(deriveInitialVenueIds(item));
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
  const venueName = (() => {
    if (item.venues.length === 0) return "Global";
    if (item.venues.length === 1) return item.venues[0].name;
    return `${item.venues[0].name} + ${item.venues.length - 1} more`;
  })();
  const taskProgress = getTaskProgress(item.tasks);
  const daysUntilTarget = Math.ceil((new Date(`${item.targetDate}T12:00:00Z`).getTime() - Date.now()) / 86_400_000);

  if (compact) {
    return (
      <article
        draggable={canDrag}
        onDragStart={canDrag ? () => onDragStart(item) : undefined}
        aria-label={`Planning item: ${item.title}`}
        className="group space-y-2 rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] p-2.5 shadow-card transition hover:-translate-y-px hover:border-[var(--hair-strong)]"
      >
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="flex items-center gap-1 font-brand-mono text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-[var(--ink-soft)]">
              {canDrag ? <GripVertical className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              <ClipboardList className="h-3 w-3" aria-hidden="true" />
              {item.typeLabel}
            </p>
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-[var(--ink)]">{item.title}</h3>
          </div>
          <div ref={compactStatusRef} className="relative shrink-0">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setCompactStatusOpen((open) => !open)}
              aria-label="Change status"
              aria-haspopup="listbox"
              aria-expanded={compactStatusOpen}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-full border px-2 font-brand-mono text-[0.58rem] font-semibold uppercase leading-none tracking-[0.06em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mustard-tint)] disabled:cursor-not-allowed disabled:opacity-60",
                status === "planned" && "border-[var(--hair)] bg-[var(--paper-tint)] text-[var(--ink-muted)]",
                status === "in_progress" && "border-[var(--slate)] bg-[var(--slate-tint)] text-[var(--slate)]",
                status === "blocked" && "border-[var(--mustard)] bg-[var(--mustard-tint)] text-[var(--mustard-dark)]",
                status === "done" && "border-[var(--sage-dark)] bg-[var(--sage-tint)] text-[var(--sage-dark)]",
                status === "cancelled" && "border-[var(--burgundy)] bg-[var(--burgundy-tint)] text-[var(--burgundy)]"
              )}
            >
              <span>{getStatusLabel(status)}</span>
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </button>
            {compactStatusOpen ? (
              <div
                role="listbox"
                aria-label="Planning status"
                className="absolute right-0 top-full z-30 mt-1 min-w-[10rem] rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] py-1 shadow-card"
              >
                {STATUS_OPTIONS.map((option) => {
                  const selected = option.value === status;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--ink)] transition-colors hover:bg-[var(--paper-tint)]"
                      onClick={() => {
                        setCompactStatusOpen(false);
                        if (!selected) {
                          handleCompactStatusChange(option.value);
                        }
                      }}
                    >
                      <span className="flex h-4 w-4 items-center justify-center">
                        {selected ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                      </span>
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2 font-brand-mono text-[0.6rem] uppercase tracking-[0.04em] text-[var(--ink-muted)]">
          <span>{formatDate(item.targetDate)}</span>
          <SLAChip days={daysUntilTarget} />
          <span className="h-1 w-1 rounded-full bg-[var(--hair-strong)]" />
          <span className="inline-flex min-w-0 items-center gap-1">
            <Avatar name={item.ownerName ?? ownerName} size={16} />
            <span className="truncate">{item.ownerName ?? ownerName}</span>
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
          <span className="truncate">{venueName}</span>
          {item.seriesId ? <span className="rounded-full bg-[var(--canvas-2)] px-1.5 py-0.5">Recurring</span> : null}
        </div>

        {item.description ? <p className="line-clamp-2 text-xs leading-snug text-[var(--ink-muted)]">{item.description}</p> : null}

        {item.tasks.length > 0 ? (
          <div className="flex items-center justify-between gap-2 border-t border-[var(--hair)] pt-2">
            <span className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
              <ProgressRing value={taskProgress.pct} />
              {taskProgress.resolved}/{taskProgress.total} tasks
            </span>
            <span className="font-brand-mono text-[0.6rem] uppercase tracking-[0.04em] text-[var(--ink-soft)]">{taskProgress.pct}%</span>
          </div>
        ) : null}

        {onOpenDetails ? (
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="ghost" onClick={() => onOpenDetails(item)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Manage
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
      className="space-y-2 rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] p-3 shadow-card"
    >
      <header className="flex items-start justify-between gap-1.5">
        <div className="space-y-0.5">
          <p className="flex items-center gap-1 font-brand-mono text-[0.62rem] uppercase tracking-[0.1em] text-[var(--ink-soft)]">
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
              <h3 className="text-base font-semibold text-[var(--ink)]">{title}</h3>
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
              <p className="text-xs text-[var(--ink-muted)]">{typeLabel}</p>
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
        <div className="rounded-[var(--radius-sm)] border border-[var(--hair)] px-2 py-1.5 text-xs text-subtle">
          <p className="font-semibold text-[var(--ink)]">Target</p>
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

        <div className="rounded-[var(--radius-sm)] border border-[var(--hair)] px-2 py-1.5 text-xs text-subtle">
          <p className="font-semibold text-[var(--ink)]">Owner</p>
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

        <div className="rounded-[var(--radius-sm)] border border-[var(--hair)] px-2 py-1.5 text-xs text-subtle">
          <FieldLabel
            help="Pick no venues for a global item, or select one or more venues to link this item. Tasks with a one per venue SOP setting fan out automatically."
            className="text-xs font-semibold"
          >
            Venue
          </FieldLabel>
          {editingField === "venueId" ? (
            <div className="mt-0.5 space-y-2">
              <VenueMultiSelect
                venues={venues.map((venue) => ({
                  id: venue.id,
                  name: venue.name,
                  category: venue.category ?? "pub",
                  isInternal: venue.isInternal
                } satisfies VenueOption))}
                selectedIds={selectedVenueIds}
                onChange={setSelectedVenueIds}
                disabled={isPending}
                emptyLabel="Global item"
                emptyDescription="No venue-specific ownership or rollout."
              />
              <div className="flex justify-end">
                <InlineFieldActions field="venueId" />
              </div>
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

        <div className="rounded-[var(--radius-sm)] border border-[var(--hair)] px-2 py-1.5 text-xs text-subtle">
          <p className="font-semibold text-[var(--ink)]">Recurring</p>
          <p className="mt-0.5">
            {item.seriesId ? "Yes" : "No"}
            {item.isException ? " (exception)" : ""}
          </p>
        </div>
      </div>

      <div className="rounded-[var(--radius-sm)] border border-[var(--hair)] px-2 py-1.5">
        <p className="text-xs font-semibold text-[var(--ink)]">Description</p>
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
            <p className="text-sm text-[var(--ink)]">{description.trim().length ? description : "No description"}</p>
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
              <p className="text-xs font-medium text-[var(--burgundy)]">Confirm delete?</p>
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
                currentUserId={currentUserId}
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
    <div className="flex items-start justify-between gap-2 rounded-[8px] border border-dashed border-[var(--mustard)] bg-[var(--mustard-tint)] px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-[var(--mustard-dark)]" aria-hidden="true" />
          <span className="truncate text-sm font-medium text-[var(--ink)]">{item.eventName}</span>
          <span className="shrink-0 rounded bg-[var(--mustard-tint)] px-1.5 py-0.5 font-brand-mono text-[0.6rem] uppercase tracking-[0.04em] text-[var(--mustard-dark)]">
            {CATEGORY_LABELS[item.category]}
          </span>
        </div>
        <p className="mt-0.5 font-brand-mono text-[0.6rem] uppercase tracking-[0.04em] text-[var(--mustard-dark)]">{formattedDate}</p>
        {item.description && (
          <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">{item.description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={converting || dismissing}
          onClick={handleConvert}
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

const NOTE_DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric" });
const NOTE_DAY_MONTH_FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });
const NOTE_DAY_MONTH_YEAR_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric"
});

/** "1 Aug" for a single day, "1 to 3 Aug" for a range inside one month. */
export function formatNoteDateRange(startDate: string, endDate: string | null): string {
  const start = new Date(`${startDate}T12:00:00Z`);
  if (!endDate || endDate === startDate) {
    return NOTE_DAY_MONTH_FORMAT.format(start);
  }

  const end = new Date(`${endDate}T12:00:00Z`);
  if (startDate.slice(0, 4) !== endDate.slice(0, 4)) {
    return `${NOTE_DAY_MONTH_YEAR_FORMAT.format(start)} to ${NOTE_DAY_MONTH_YEAR_FORMAT.format(end)}`;
  }
  if (startDate.slice(0, 7) === endDate.slice(0, 7)) {
    return `${NOTE_DAY_FORMAT.format(start)} to ${NOTE_DAY_MONTH_FORMAT.format(end)}`;
  }
  return `${NOTE_DAY_MONTH_FORMAT.format(start)} to ${NOTE_DAY_MONTH_FORMAT.format(end)}`;
}

type CalendarNoteCardProps = {
  note: CalendarNote;
  onOpen: (note: CalendarNote) => void;
};

export function CalendarNoteCard({ note, onOpen }: CalendarNoteCardProps) {
  const dateLabel = formatNoteDateRange(note.startDate, note.endDate);

  return (
    <button
      type="button"
      onClick={() => onOpen(note)}
      aria-label={`Note: ${note.title}, ${note.venueName}, ${dateLabel}`}
      className="w-full space-y-1 rounded-[8px] border border-[var(--plum)] bg-[var(--plum-tint)] p-2.5 text-left shadow-card transition hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--plum)]"
    >
      <span className="flex items-center gap-1 font-brand-mono text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-[var(--plum)]">
        <span aria-hidden="true">📌</span>
        Note
      </span>
      <span className="line-clamp-2 block text-sm font-semibold leading-snug text-[var(--ink)]">{note.title}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--ink-muted)]">
        <span className="truncate">{note.venueName}</span>
        <span className="h-1 w-1 rounded-full bg-[var(--hair-strong)]" aria-hidden="true" />
        <span>{dateLabel}</span>
      </span>
    </button>
  );
}

type EventOverlayCardProps = {
  event: PlanningEventOverlay;
  canApprove?: boolean;
  onChanged?: () => void;
};

const EVENT_STATUS_BADGE_VARIANT: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  pending_approval: "info",
  approved_pending_details: "info",
  draft: "neutral",
  submitted: "info",
  needs_revisions: "warning",
  approved: "success",
  completed: "success",
  rejected: "danger",
  cancelled: "danger",
};

export function EventOverlayCard({ event, canApprove, onChanged }: EventOverlayCardProps) {
  const statusTone = EVENT_STATUS_BADGE_VARIANT[event.status] ?? "neutral";
  const hasWebCopy = Boolean(event.publicTitle);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [isPending, startTransition] = useTransition();
  // "Cancelled" is handled by the dedicated CancelEventDialog (which refunds paid
  // bookings and notifies attendees), not this quick status dropdown.
  const statusOptions =
    canApprove && event.status === "approved"
      ? [
          { value: "approved" as const, label: "Approved" },
          { value: "completed" as const, label: "Completed" }
        ]
      : [];

  function handleArchiveDraft() {
    startTransition(async () => {
      const result = await archiveDraftEventAction({ eventId: event.eventId });
      if (!result.success) {
        toast.error(result.message ?? "Could not archive the draft event.");
        return;
      }
      toast.success(result.message ?? "Draft event archived.");
      setConfirmArchive(false);
      onChanged?.();
    });
  }

  return (
    <article aria-label={`Event: ${event.publicTitle ?? event.title}`} className="space-y-2 rounded-[8px] border border-[var(--hair)] bg-[var(--slate-tint)] p-2.5 shadow-card">
      <header className="flex items-start justify-between gap-1.5">
        <div className="space-y-0.5">
          <p className="flex items-center gap-1 font-brand-mono text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-[var(--slate)]">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            Event
          </p>
          <h3 className="text-sm font-semibold leading-snug text-[var(--ink)]">{event.publicTitle ?? event.title}</h3>
          {event.publicTeaser && (
            <p className="line-clamp-2 text-xs text-[var(--ink-muted)]">{event.publicTeaser}</p>
          )}
        </div>
        {statusOptions.length > 0 ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <StatusDropdown
              value="approved"
              label="Event status"
              options={statusOptions}
              toneByValue={{
                approved: "success",
                completed: "success"
              }}
              onChangeStatus={(status) =>
                status === "approved"
                  ? Promise.resolve({ success: true, message: "Event status is already approved." })
                  : updateEventStatusAction({ eventId: event.eventId, status })
              }
              onChanged={onChanged}
            />
            <Button asChild variant="outline" size="sm">
              <Link href={`/events/${event.eventId}/reschedule`}>Reschedule</Link>
            </Button>
            <CancelEventDialog
              eventId={event.eventId}
              eventTitle={event.publicTitle ?? event.title}
              onChanged={onChanged}
            />
          </div>
        ) : (
          <Badge variant={statusTone}>{event.status.replace(/_/g, " ")}</Badge>
        )}
      </header>

      <div className="grid gap-1.5 text-xs text-[var(--ink-muted)] md:grid-cols-2">
        <p>
          <span className="font-semibold text-[var(--ink)]">Date:</span>{" "}
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
          <span className="font-semibold text-[var(--ink)]">Venue:</span>{" "}
          {event.venueName ?? "Unknown venue"}
          {event.venueSpace ? ` · ${event.venueSpace}` : ""}
        </p>
        <p>
          <span className="font-semibold text-[var(--ink)]">Web copy:</span>{" "}
          {hasWebCopy ? "Ready" : "Not yet"}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {event.status === "draft" ? (
          <>
            {confirmArchive ? (
              <>
                <p className="text-xs font-medium text-[var(--burgundy)]">Archive draft?</p>
                <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setConfirmArchive(false)}>
                  Cancel
                </Button>
                <Button type="button" size="sm" variant="destructive" disabled={isPending} onClick={handleArchiveDraft}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> {isPending ? "Archiving..." : "Confirm"}
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setConfirmArchive(true)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Archive draft
              </Button>
            )}
            <Link href={`/events/${event.eventId}`}>
              <Button type="button" size="sm" variant="subtle">
                <Pencil className="h-4 w-4" aria-hidden="true" /> Continue draft
              </Button>
            </Link>
          </>
        ) : (
          <>
            {canApprove && ["submitted", "needs_revisions"].includes(event.status) ? (
              <ApproveEventButton eventId={event.eventId} size="sm" className="h-auto px-3 py-1 text-xs" hasWebCopy={hasWebCopy} />
            ) : null}
            <Link href={`/events/${event.eventId}`}>
              <Button type="button" size="sm" variant="subtle">
                <ArrowRight className="h-4 w-4" aria-hidden="true" /> Manage
              </Button>
            </Link>
          </>
        )}
      </div>
    </article>
  );
}
