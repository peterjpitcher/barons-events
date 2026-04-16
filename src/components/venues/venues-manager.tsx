"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { Clock, Plus, Save, Trash2 } from "lucide-react";

type UserOption = { id: string; name: string };

type VenuesManagerProps = {
  venues: VenueRow[];
  reviewers: ReviewerOption[];
  users: UserOption[];
};

const errorInputClass = "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]";

export function VenuesManager({ venues, reviewers, users }: VenuesManagerProps) {
  return (
    <div className="space-y-6">
      <VenueCreateForm reviewers={reviewers} users={users} />
      <VenueTable venues={venues} reviewers={reviewers} users={users} />
    </div>
  );
}

function VenueCreateForm({ reviewers, users }: { reviewers: ReviewerOption[]; users: UserOption[] }) {
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
        <form ref={formRef} action={formAction} className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_auto]" noValidate>
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
            <Label htmlFor="new-venue-default-manager">Default manager responsible</Label>
            <Select id="new-venue-default-manager" name="defaultManagerResponsibleId" defaultValue="">
              <option value="">No default manager</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-venue-default-approver">Default approver</Label>
            <Select id="new-venue-default-approver" name="defaultApproverId" defaultValue="">
              <option value="">No default approver</option>
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

function VenueTable({ venues, reviewers, users }: VenuesManagerProps) {
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
            <th scope="col" className="px-4 py-3">Venue</th>
            <th scope="col" className="px-4 py-3">Manager Responsible</th>
            <th scope="col" className="px-4 py-3">Default Reviewer</th>
            <th scope="col" className="px-4 py-3">Google Review URL</th>
            <th scope="col" className="px-4 py-3">Hours</th>
            <th scope="col" className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {venues.map((venue) => (
            <VenueRowEditor key={venue.id} venue={venue} reviewers={reviewers} users={users} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VenueRowEditor({ venue, reviewers, users }: { venue: VenueRow; reviewers: ReviewerOption[]; users: UserOption[] }) {
  const [state, formAction] = useActionState(updateVenueAction, undefined);
  const [deleteState, deleteAction] = useActionState(deleteVenueAction, undefined);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const deleteFormRef = useRef<HTMLFormElement>(null);
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
      <td colSpan={6} className="px-4 py-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,18fr)_minmax(0,18fr)_minmax(0,16fr)_minmax(0,28fr)_auto_auto] md:items-start">
          <form id={`venue-form-${venue.id}`} action={formAction} className="contents" noValidate>
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
              <label className="sr-only" htmlFor={`venue-manager-${venue.id}`}>
                Default manager responsible
              </label>
              <Select
                id={`venue-manager-${venue.id}`}
                name="defaultManagerResponsibleId"
                defaultValue={venue.default_manager_responsible_id ?? ""}
              >
                <option value="">No default manager</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <label className="sr-only" htmlFor={`venue-approver-${venue.id}`}>
                Default approver
              </label>
              <Select id={`venue-approver-${venue.id}`} name="defaultApproverId" defaultValue={venue.default_approver_id ?? ""}>
                <option value="">No default approver</option>
                {reviewers.map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <label className="sr-only" htmlFor={`venue-google-review-${venue.id}`}>
                Google Review URL
              </label>
              <Input
                id={`venue-google-review-${venue.id}`}
                name="googleReviewUrl"
                type="url"
                defaultValue={venue.google_review_url ?? ""}
                placeholder="Google Review URL"
              />
            </div>
          </form>
          <div className="flex items-start justify-center">
            <Button asChild variant="ghost" size="sm" aria-label={`Opening hours for ${venue.name}`}>
              <Link href={`/venues/${venue.id}/opening-hours`}>
                <Clock className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <div className="flex items-start justify-end gap-1">
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              aria-label={`Save ${venue.name}`}
              form={`venue-form-${venue.id}`}
            >
              <Save className="h-4 w-4" aria-hidden="true" />
            </Button>
            <form ref={deleteFormRef} action={deleteAction}>
              <input type="hidden" name="venueId" value={venue.id} />
              <Button type="button" variant="destructive" size="sm" aria-label={`Delete ${venue.name}`} onClick={() => setDeleteConfirmOpen(true)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </form>
            <ConfirmDialog
              open={deleteConfirmOpen}
              title={`Delete ${venue.name}?`}
              description="This will permanently remove the venue. Events linked to it may be affected."
              confirmLabel="Delete"
              variant="danger"
              onConfirm={() => { setDeleteConfirmOpen(false); deleteFormRef.current?.requestSubmit(); }}
              onCancel={() => setDeleteConfirmOpen(false)}
            />
          </div>
        </div>
      </td>
    </tr>
  );
}
