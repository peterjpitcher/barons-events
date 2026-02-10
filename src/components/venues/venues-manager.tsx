"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createVenueAction, deleteVenueAction, updateVenueAction } from "@/actions/venues";
import type { VenueRow } from "@/lib/venues";
import type { ReviewerOption } from "@/lib/reviewers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { cn } from "@/lib/utils";
import { Plus, Save, Trash2 } from "lucide-react";

type VenuesManagerProps = {
  venues: VenueRow[];
  reviewers: ReviewerOption[];
};

const errorInputClass = "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]";

export function VenuesManager({ venues, reviewers }: VenuesManagerProps) {
  return (
    <div className="space-y-6">
      <VenueCreateForm reviewers={reviewers} />
      <VenueTable venues={venues} reviewers={reviewers} />
    </div>
  );
}

function VenueCreateForm({ reviewers }: { reviewers: ReviewerOption[] }) {
  const [state, formAction] = useActionState(createVenueAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const nameError = state?.fieldErrors?.name;

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      formRef.current?.reset();
      router.refresh();
    } else if (!state.fieldErrors) {
      toast.error(state.message);
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a venue</CardTitle>
        <CardDescription>Manage your venues in a table so updates stay consistent and quick.</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]" noValidate>
          <div className="space-y-2">
            <Label htmlFor="new-venue-name">Venue name</Label>
            <Input
              id="new-venue-name"
              name="name"
              placeholder="Barons Riverside"
              required
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? "new-venue-name-error" : undefined}
              className={nameError ? errorInputClass : undefined}
            />
            <FieldError id="new-venue-name-error" message={nameError} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-venue-default-reviewer">Default reviewer</Label>
            <Select id="new-venue-default-reviewer" name="defaultReviewerId" defaultValue="">
              <option value="">No default reviewer</option>
              {reviewers.map((reviewer) => (
                <option key={reviewer.id} value={reviewer.id}>
                  {reviewer.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-end justify-end">
            <SubmitButton
              label="Add venue"
              pendingLabel="Saving..."
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
              hideLabel
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function VenueTable({ venues, reviewers }: VenuesManagerProps) {
  if (venues.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-subtle">No venues yet. Add your first location above.</CardContent>
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-soft">
      <table className="min-w-full border-collapse">
        <thead>
          <tr className="bg-[var(--color-muted-surface)] text-left text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
            <th className="px-4 py-3">Venue</th>
            <th className="px-4 py-3">Default reviewer</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {venues.map((venue) => (
            <VenueRowEditor key={venue.id} venue={venue} reviewers={reviewers} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VenueRowEditor({ venue, reviewers }: { venue: VenueRow; reviewers: ReviewerOption[] }) {
  const [state, formAction] = useActionState(updateVenueAction, undefined);
  const [deleteState, deleteAction] = useActionState(deleteVenueAction, undefined);
  const router = useRouter();
  const nameError = state?.fieldErrors?.name;
  const nameErrorId = `venue-name-${venue.id}-error`;

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      router.refresh();
    } else if (!state.fieldErrors) {
      toast.error(state.message);
    }
  }, [state, router]);

  useEffect(() => {
    if (!deleteState?.message) return;
    if (deleteState.success) {
      toast.success(deleteState.message);
      router.refresh();
    } else {
      toast.error(deleteState.message);
    }
  }, [deleteState, router]);

  return (
    <tr className="border-t border-[var(--color-border)]">
      <td colSpan={3} className="px-4 py-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto_auto] md:items-start">
          <form action={formAction} className="contents" noValidate>
            <input type="hidden" name="venueId" value={venue.id} />
            <div className="space-y-2">
              <label className="sr-only" htmlFor={`venue-name-${venue.id}`}>
                Venue name
              </label>
              <Input
                id={`venue-name-${venue.id}`}
                name="name"
                defaultValue={venue.name}
                required
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? nameErrorId : undefined}
                className={cn(nameError ? errorInputClass : undefined)}
              />
              <FieldError id={nameErrorId} message={nameError} />
            </div>
            <div className="space-y-2">
              <label className="sr-only" htmlFor={`venue-reviewer-${venue.id}`}>
                Default reviewer
              </label>
              <Select id={`venue-reviewer-${venue.id}`} name="defaultReviewerId" defaultValue={venue.default_reviewer_id ?? ""}>
                <option value="">No default reviewer</option>
                {reviewers.map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-start justify-end">
              <SubmitButton
                label="Save"
                pendingLabel="Saving..."
                variant="secondary"
                size="sm"
                icon={<Save className="h-4 w-4" aria-hidden="true" />}
              />
            </div>
          </form>
          <div className="flex items-start justify-end">
            <form action={deleteAction}>
              <input type="hidden" name="venueId" value={venue.id} />
              <Button type="submit" variant="destructive" size="sm" aria-label={`Delete ${venue.name}`}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete
              </Button>
            </form>
          </div>
        </div>
      </td>
    </tr>
  );
}
