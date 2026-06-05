"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updatePlanningItemAction } from "@/actions/planning";
import { StatusDropdown } from "@/components/events/status-dropdown";
import { VenueMultiSelect, type VenueOption } from "@/components/venues/venue-multi-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { normaliseEventDateTimeForStorage, toLondonDateTimeInputValue } from "@/lib/datetime";
import { deriveInitialVenueIds } from "@/lib/planning/utils";
import type { PlanningItem, PlanningItemStatus, PlanningPerson, PlanningVenueOption } from "@/lib/planning/types";

type PlanningItemEditorShellProps = {
  item: PlanningItem;
  users: PlanningPerson[];
  venues: PlanningVenueOption[];
  canEdit: boolean;
};

const STATUS_OPTIONS: Array<{ value: PlanningItemStatus; label: string }> = [
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" }
];

const STATUS_TONES: Partial<Record<PlanningItemStatus, "neutral" | "info" | "warning" | "success" | "danger">> = {
  planned: "neutral",
  in_progress: "info",
  blocked: "warning",
  done: "success",
  cancelled: "danger"
};

function toVenueOptions(venues: PlanningVenueOption[]): VenueOption[] {
  return venues.map((venue) => ({
    id: venue.id,
    name: venue.name,
    category: venue.category ?? "pub",
    isInternal: venue.isInternal
  }));
}

function deriveVenuePickerIds(item: PlanningItem, venues: PlanningVenueOption[]): string[] {
  const ids = deriveInitialVenueIds(item);
  return ids.length > 0 ? ids : venues.map((venue) => venue.id);
}

export function PlanningStatusControl({
  itemId,
  status,
  disabled = false
}: {
  itemId: string;
  status: PlanningItemStatus;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState(status);

  useEffect(() => {
    setCurrentStatus(status);
  }, [status]);

  function handleStatusChange(nextStatus: PlanningItemStatus) {
    return updatePlanningItemAction({
      itemId,
      status: nextStatus
    }).then((result) => {
      if (result.success) {
        setCurrentStatus(nextStatus);
        router.refresh();
      }
      return result;
    });
  }

  return (
    <StatusDropdown
      value={currentStatus}
      label="Planning status"
      options={STATUS_OPTIONS}
      disabled={disabled}
      toneByValue={STATUS_TONES}
      onChangeStatus={handleStatusChange}
      onChanged={() => router.refresh()}
    />
  );
}

export function PlanningItemEditorShell({
  item,
  users,
  venues,
  canEdit
}: PlanningItemEditorShellProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [title, setTitle] = useState(item.title);
  const [typeLabel, setTypeLabel] = useState(item.typeLabel);
  const [description, setDescription] = useState(item.description ?? "");
  const [ownerId, setOwnerId] = useState(item.ownerId ?? "");
  const [targetDate, setTargetDate] = useState(item.targetDate);
  const [startAtInput, setStartAtInput] = useState(() => toLondonDateTimeInputValue(item.startAt));
  const [endAtInput, setEndAtInput] = useState(() => toLondonDateTimeInputValue(item.endAt));
  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>(() => deriveVenuePickerIds(item, venues));

  const sortedUsers = useMemo(
    () => [...users].sort((left, right) => left.name.localeCompare(right.name)),
    [users]
  );
  const venueOptions = useMemo(() => toVenueOptions(venues), [venues]);

  useEffect(() => {
    setTitle(item.title);
    setTypeLabel(item.typeLabel);
    setDescription(item.description ?? "");
    setOwnerId(item.ownerId ?? "");
    setTargetDate(item.targetDate);
    setStartAtInput(toLondonDateTimeInputValue(item.startAt));
    setEndAtInput(toLondonDateTimeInputValue(item.endAt));
    setSelectedVenueIds(deriveVenuePickerIds(item, venues));
    setFieldErrors({});
  }, [item, venues]);

  function validate(): Record<string, string> {
    return {
      ...(!title.trim() ? { title: "Add a title" } : {}),
      ...(!typeLabel.trim() ? { typeLabel: "Add a planning type" } : {}),
      ...(!targetDate ? { targetDate: "Choose a target date" } : {}),
      ...(startAtInput && endAtInput && endAtInput < startAtInput ? { endAt: "End must be after start" } : {})
    };
  }

  function handleStartChange(value: string): void {
    setStartAtInput(value);
    if (value) {
      setTargetDate(value.slice(0, 10));
    }
  }

  function handleSave(): void {
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Check the highlighted fields.");
      return;
    }

    startTransition(async () => {
      let startAt: string | null = null;
      let endAt: string | null = null;
      try {
        startAt = startAtInput ? normaliseEventDateTimeForStorage(startAtInput) : null;
        endAt = endAtInput ? normaliseEventDateTimeForStorage(endAtInput) : null;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Check the start and end times.");
        return;
      }

      const payload = {
        itemId: item.id,
        title: title.trim(),
        typeLabel: typeLabel.trim(),
        description: description.trim() ? description.trim() : null,
        venueIds: selectedVenueIds,
        ownerId,
        targetDate,
        ...(startAtInput || item.startAt ? { startAt } : {}),
        ...(endAtInput || item.endAt ? { endAt } : {})
      };

      const result = await updatePlanningItemAction(payload);

      if (!result.success) {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.message ?? "Could not update planning item.");
        return;
      }

      setFieldErrors({});
      toast.success("Planning item updated.");
      router.refresh();
    });
  }

  const disabled = isPending || !canEdit;

  return (
    <Card>
      <CardHeader className="!rounded-t-[var(--radius-lg)] !bg-[var(--navy)] px-4 py-2.5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider !text-white">
          Planning Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <FieldLabel htmlFor="planning-title">Planning title</FieldLabel>
            <Input
              id="planning-title"
              value={title}
              maxLength={160}
              disabled={disabled}
              className="h-12 text-[16px] md:h-10 md:text-sm"
              aria-invalid={Boolean(fieldErrors.title)}
              aria-describedby="planning-title-error"
              onChange={(event) => setTitle(event.target.value)}
            />
            <FieldError id="planning-title-error" message={fieldErrors.title} />
          </div>

          <div className="space-y-1">
            <FieldLabel
              help="Use Global item for all venues, or select one or more specific venues."
            >
              Venues
            </FieldLabel>
            <VenueMultiSelect
              venues={venueOptions}
              selectedIds={selectedVenueIds}
              onChange={setSelectedVenueIds}
              disabled={disabled}
              allowEmpty={false}
              globalSelectionMode="all"
              emptyLabel="Global item"
              emptyDescription="All venues are included."
              placeholder="Choose venues"
            />
            <FieldError id="planning-venue-error" message={fieldErrors.venueId ?? fieldErrors.venueIds} />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <FieldLabel htmlFor="planning-type">Planning type</FieldLabel>
            <Input
              id="planning-type"
              value={typeLabel}
              maxLength={120}
              disabled={disabled}
              className="h-12 text-[16px] md:h-10 md:text-sm"
              aria-invalid={Boolean(fieldErrors.typeLabel)}
              aria-describedby="planning-type-error"
              onChange={(event) => setTypeLabel(event.target.value)}
            />
            <FieldError id="planning-type-error" message={fieldErrors.typeLabel} />
          </div>

          <div className="space-y-1">
            <FieldLabel htmlFor="planning-owner">Manager Responsible</FieldLabel>
            <Select
              id="planning-owner"
              value={ownerId}
              disabled={disabled}
              className="h-12 text-[16px] md:h-10 md:text-sm"
              onChange={(event) => setOwnerId(event.target.value)}
            >
              <option value="">Unassigned</option>
              {sortedUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <FieldLabel htmlFor="planning-start">Starts</FieldLabel>
            <Input
              id="planning-start"
              type="datetime-local"
              value={startAtInput}
              disabled={disabled}
              className="h-12 text-[16px] md:h-10 md:text-sm"
              aria-invalid={Boolean(fieldErrors.startAt ?? fieldErrors.targetDate)}
              aria-describedby="planning-start-error"
              onChange={(event) => handleStartChange(event.target.value)}
            />
            <FieldError id="planning-start-error" message={fieldErrors.startAt ?? fieldErrors.targetDate} />
          </div>

          <div className="space-y-1">
            <FieldLabel htmlFor="planning-end">Ends</FieldLabel>
            <Input
              id="planning-end"
              type="datetime-local"
              value={endAtInput}
              disabled={disabled}
              className="h-12 text-[16px] md:h-10 md:text-sm"
              aria-invalid={Boolean(fieldErrors.endAt)}
              aria-describedby="planning-end-error"
              onChange={(event) => setEndAtInput(event.target.value)}
            />
            <FieldError id="planning-end-error" message={fieldErrors.endAt} />
          </div>
        </div>

        <div className="space-y-1">
          <FieldLabel htmlFor="planning-description">Description</FieldLabel>
          <Textarea
            id="planning-description"
            value={description}
            rows={4}
            maxLength={2000}
            disabled={disabled}
            placeholder="Optional context"
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        {canEdit ? (
          <div className="hidden justify-end pt-1 md:flex">
            <Button type="button" variant="primary" disabled={isPending} onClick={handleSave}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Save planning item
            </Button>
          </div>
        ) : null}
      </CardContent>
      {canEdit ? (
        <div className="mobile-actionbar md:hidden">
          <Button type="button" variant="primary" className="h-12 flex-1" disabled={isPending} onClick={handleSave}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Save planning item
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
