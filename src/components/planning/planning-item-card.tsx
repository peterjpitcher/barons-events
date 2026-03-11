"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, GripVertical, Pencil, Trash2, X } from "lucide-react";
import { ApproveEventButton } from "@/components/events/approve-event-button";
import { convertInspirationItemAction, deletePlanningItemAction, dismissInspirationItemAction, updatePlanningItemAction } from "@/actions/planning";
import { PlanningTaskList } from "@/components/planning/planning-task-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PlanningEventOverlay, PlanningInspirationItem, PlanningItem, PlanningPerson, PlanningVenueOption } from "@/lib/planning/types";
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
      const result: any = await work();
      if (result && typeof result === "object" && "success" in result && !result.success) {
        toast.error(result.message ?? "Could not update planning item.");
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
        className="space-y-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-2.5 shadow-soft"
      >
        <header className="flex items-start justify-between gap-1.5">
          <div className="space-y-0.5">
            <p className="flex items-center gap-1 text-xs uppercase tracking-[0.08em] text-subtle">
              {canDrag ? <GripVertical className="h-3.5 w-3.5" aria-hidden="true" /> : null} Planning item
            </p>
            <h3 className="text-base font-semibold text-[var(--color-text)]">{item.title}</h3>
            <p className="text-xs text-subtle">{item.typeLabel}</p>
          </div>
          <Badge variant={STATUS_BADGE_VARIANT[item.status]}>{formatStatus(item.status)}</Badge>
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
      className="space-y-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-2.5 shadow-soft"
    >
      <header className="flex items-start justify-between gap-1.5">
        <div className="space-y-0.5">
          <p className="flex items-center gap-1 text-xs uppercase tracking-[0.08em] text-subtle">
            {canDrag ? <GripVertical className="h-3.5 w-3.5" aria-hidden="true" /> : null} Planning item
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

      <PlanningTaskList itemId={item.id} tasks={item.tasks} users={users} onChanged={onChanged} />
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

export function EventOverlayCard({ event, canApprove }: EventOverlayCardProps) {
  const statusTone: "neutral" | "info" | "warning" | "success" | "danger" =
    event.status === "submitted"
      ? "info"
      : event.status === "needs_revisions"
        ? "warning"
        : event.status === "approved" || event.status === "completed"
          ? "success"
          : event.status === "rejected"
            ? "danger"
            : "neutral";

  const hasWebCopy = Boolean(event.publicTitle);
  const isLiveOnWebsite = event.status === "approved" && hasWebCopy;

  return (
    <article className="space-y-1.5 rounded-[var(--radius)] border border-[rgba(39,54,64,0.14)] bg-[rgba(39,54,64,0.03)] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.08em] text-subtle">Event (read-only)</p>
        {isLiveOnWebsite && <Badge variant="success">Live on website</Badge>}
      </div>
      <h3 className="text-base font-semibold text-[var(--color-text)]">
        <Link href={`/events/${event.eventId}`} className="transition-colors hover:text-[var(--color-primary-700)]">
          {event.publicTitle ?? event.title}
        </Link>
      </h3>
      {event.publicTeaser && (
        <p className="text-xs text-subtle">{event.publicTeaser}</p>
      )}
      <p className="text-xs text-subtle">
        {event.venueName ?? "Unknown venue"}
        {event.venueSpace ? ` · ${event.venueSpace}` : ""}
      </p>
      <p className="text-xs text-subtle">
        {new Date(event.startAt).toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit"
        })}
      </p>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant={statusTone}>{event.status.replace(/_/g, " ")}</Badge>
          <Badge variant={hasWebCopy ? "success" : "neutral"}>
            {hasWebCopy ? "Webpage ready" : "No web copy"}
          </Badge>
        </div>
        {canApprove && ["submitted", "draft"].includes(event.status) ? (
          <ApproveEventButton eventId={event.eventId} size="sm" className="h-auto px-3 py-1 text-xs" hasWebCopy={hasWebCopy} />
        ) : null}
      </div>
    </article>
  );
}
