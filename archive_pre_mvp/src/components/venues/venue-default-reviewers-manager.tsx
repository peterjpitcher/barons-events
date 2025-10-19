"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  addVenueDefaultReviewerAction,
  removeVenueDefaultReviewerAction,
  type VenueReviewerFormState,
} from "@/actions/venues";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

type ReviewerOption = {
  id: string;
  name: string;
  email: string | null;
};

type AssignedReviewer = {
  mappingId: string;
  reviewerId: string;
  name: string;
  email: string | null;
};

type VenueDefaultReviewersManagerProps = {
  venueId: string;
  reviewers: ReviewerOption[];
  assignedReviewers: AssignedReviewer[];
};

const initialState: VenueReviewerFormState = {};

const FieldError = ({ message }: { message?: string }) =>
  message ? (
    <p className="text-xs font-medium text-[var(--color-danger)]">{message}</p>
  ) : null;

const AddButton = ({ disabled }: { disabled?: boolean }) => {
  const { pending } = useFormStatus();
  const isDisabled = pending || disabled;
  return (
    <Button type="submit" size="sm" disabled={isDisabled}>
      {pending ? "Saving…" : "Add reviewer"}
    </Button>
  );
};

const RemoveButton = () => {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" size="sm" disabled={pending}>
      {pending ? "Removing…" : "Remove"}
    </Button>
  );
};

export function VenueDefaultReviewersManager({
  venueId,
  reviewers,
  assignedReviewers,
}: VenueDefaultReviewersManagerProps) {
  const [addState, addAction] = useActionState(
    async (_state: VenueReviewerFormState | undefined, formData: FormData) =>
      (await addVenueDefaultReviewerAction(_state, formData)) ?? undefined,
    initialState
  );
  const [removeState, removeAction] = useActionState(
    async (_state: VenueReviewerFormState | undefined, formData: FormData) =>
      (await removeVenueDefaultReviewerAction(formData)) ?? undefined,
    initialState
  );

  const assignedIds = useMemo(
    () => new Set(assignedReviewers.map((entry) => entry.reviewerId)),
    [assignedReviewers]
  );

  const availableOptions = useMemo(
    () => reviewers.filter((option) => !assignedIds.has(option.id)),
    [reviewers, assignedIds]
  );

  const [selectedReviewerId, setSelectedReviewerId] = useState<string>(
    availableOptions[0]?.id ?? ""
  );

  useEffect(() => {
    setSelectedReviewerId((current) => {
      if (current && availableOptions.some((option) => option.id === current)) {
        return current;
      }
      return availableOptions[0]?.id ?? "";
    });
  }, [availableOptions]);

  const hasOptions = availableOptions.length > 0;
  const selectValue = hasOptions ? selectedReviewerId : "";

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-[var(--color-primary-900)]">
          Default reviewers
        </h3>
        <p className="text-sm text-subtle">
          Central planners listed here auto-assign when drafts from this venue are submitted.
        </p>
      </div>

      <form
        action={addAction}
        className="grid gap-3 rounded-lg border border-[rgba(39,54,64,0.12)] bg-white px-4 py-4 shadow-soft md:grid-cols-[minmax(0,1fr)_auto]"
      >
        <input type="hidden" name="venueId" value={venueId} />
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
            Reviewer
          </label>
          <Select
            name="reviewerId"
            value={selectValue}
            onChange={(event) => setSelectedReviewerId(event.target.value)}
            disabled={!hasOptions}
          >
            {hasOptions ? null : <option value="">No central planners available</option>}
            {availableOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.email ? ` · ${option.email}` : ""}
              </option>
            ))}
          </Select>
          <FieldError message={addState?.fieldErrors?.reviewerId} />
        </div>
        <div className="flex items-end justify-end">
          <AddButton disabled={!hasOptions} />
        </div>
        {addState?.error ? (
          <div className="md:col-span-2">
            <FieldError message={addState?.error} />
          </div>
        ) : null}
        {!hasOptions ? (
          <div className="md:col-span-2">
            <p className="text-xs text-subtle">
              Add more Central planners in settings to expand the reviewer pool.
            </p>
          </div>
        ) : null}
      </form>

      <div className="space-y-3">
        {assignedReviewers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[rgba(39,54,64,0.18)] bg-white/80 px-4 py-3 text-sm text-subtle">
            No default reviewers yet. Add Central planners so submissions route automatically.
          </p>
        ) : (
          <ul className="space-y-3">
            {assignedReviewers.map((entry) => (
              <li
                key={entry.mappingId}
                className="flex flex-col gap-3 rounded-lg border border-[rgba(39,54,64,0.12)] bg-white px-4 py-3 shadow-soft md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--color-primary-900)]">
                    {entry.name}
                  </p>
                  <p className="truncate text-xs text-subtle">
                    {entry.email ?? "Email not provided"}
                  </p>
                </div>
                <form action={removeAction} className="flex justify-end">
                  <input type="hidden" name="venueId" value={venueId} />
                  <input type="hidden" name="mappingId" value={entry.mappingId} />
                  <input type="hidden" name="reviewerId" value={entry.reviewerId} />
                  <RemoveButton />
                </form>
              </li>
            ))}
          </ul>
        )}
        {removeState?.error ? <FieldError message={removeState.error} /> : null}
      </div>
    </section>
  );
}
