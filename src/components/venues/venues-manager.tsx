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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Clock, Plus, Save, Trash2 } from "lucide-react";

type UserOption = { id: string; name: string };

type VenuesManagerProps = {
  venues: VenueRow[];
  reviewers: ReviewerOption[];
  users: UserOption[];
  canEdit: boolean;
};

const errorInputClass = "!border-[var(--burgundy)] focus-visible:!border-[var(--burgundy)]";

export function VenuesManager({ venues, reviewers, users, canEdit }: VenuesManagerProps) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-5">
      {canEdit ? (
        <>
          <div className="md:hidden">
            <Button type="button" variant="primary" className="h-11 w-full" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add venue
            </Button>
            <Sheet open={createOpen} onOpenChange={setCreateOpen}>
              <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Add venue</SheetTitle>
                </SheetHeader>
                <div className="p-5">
                  <VenueCreateForm reviewers={reviewers} users={users} mobileSheet onSuccess={() => setCreateOpen(false)} />
                </div>
              </SheetContent>
            </Sheet>
          </div>
          <div className="hidden md:block">
            <VenueCreateForm reviewers={reviewers} users={users} />
          </div>
        </>
      ) : null}
      <VenueTable venues={venues} reviewers={reviewers} users={users} canEdit={canEdit} />
    </div>
  );
}

function VenueCreateForm({
  reviewers,
  users,
  mobileSheet = false,
  onSuccess
}: {
  reviewers: ReviewerOption[];
  users: UserOption[];
  mobileSheet?: boolean;
  onSuccess?: () => void;
}) {
  const [state, formAction] = useActionState(createVenueAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const nameError = state?.fieldErrors?.name;

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      formRef.current?.reset();
      onSuccess?.();
      router.refresh();
    } else if (!state.fieldErrors) {
      toast.error(state.message);
    }
  }, [state, router, onSuccess]);

  return (
    <Card className={mobileSheet ? "border-0 shadow-none" : "mobile-card md:rounded-[var(--radius-lg)]"}>
      <CardHeader className={mobileSheet ? "hidden" : undefined}>
        <CardTitle>Add a venue</CardTitle>
        <CardDescription>Manage your venues in a table so updates stay consistent and quick.</CardDescription>
      </CardHeader>
      <CardContent className={mobileSheet ? "p-0" : undefined}>
        <form ref={formRef} action={formAction} className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,2fr)_auto]" noValidate>
          <div className="space-y-2">
            <Label htmlFor="new-venue-name">Venue name</Label>
            <Input
              id="new-venue-name"
              name="name"
              placeholder="Barons Riverside"
              required
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? "new-venue-name-error" : undefined}
              className={cn("h-12 text-[16px] md:h-10 md:text-sm", nameError ? errorInputClass : undefined)}
            />
            <FieldError id="new-venue-name-error" message={nameError} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-venue-category">Category</Label>
            <Select id="new-venue-category" name="category" defaultValue="pub" className="h-12 text-[16px] md:h-10 md:text-sm">
              <option value="pub">🍺 Pub</option>
              <option value="cafe">☕ Cafe</option>
            </Select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
              <input type="checkbox" name="isInternal" className="h-4 w-4" />
              Internal
            </label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-venue-default-manager">Default manager responsible</Label>
            <Select id="new-venue-default-manager" name="defaultManagerResponsibleId" defaultValue="" className="h-12 text-[16px] md:h-10 md:text-sm">
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
            <Select id="new-venue-default-approver" name="defaultApproverId" defaultValue="" className="h-12 text-[16px] md:h-10 md:text-sm">
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
              hideLabel={!mobileSheet}
              className="h-11 w-full md:h-10 md:w-auto"
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function VenueTable({ venues, reviewers, users, canEdit }: VenuesManagerProps) {
  if (venues.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-subtle">
          {canEdit ? "No venues yet. Add your first location above." : "No venues yet."}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <div className="space-y-2 md:hidden">
      {venues.map((venue) => (
        <MobileVenueCard key={venue.id} venue={venue} reviewers={reviewers} users={users} canEdit={canEdit} />
      ))}
    </div>
    <div className="data-table-shell hidden md:block">
      <table className="data-table min-w-full">
        <thead>
          <tr className="bg-[var(--canvas-2)] text-left text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
            <th scope="col" className="px-4 py-3">Venue</th>
            <th scope="col" className="px-4 py-3">Category</th>
            <th scope="col" className="px-4 py-3">Internal</th>
            <th scope="col" className="px-4 py-3">Manager Responsible</th>
            <th scope="col" className="px-4 py-3">Default Reviewer</th>
            <th scope="col" className="px-4 py-3">Google Review URL</th>
            <th scope="col" className="px-4 py-3">Hours</th>
            <th scope="col" className="px-4 py-3 text-right">{canEdit ? "Actions" : ""}</th>
          </tr>
        </thead>
        <tbody>
          {venues.map((venue) => (
            <VenueRowEditor key={venue.id} venue={venue} reviewers={reviewers} users={users} canEdit={canEdit} />
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

function MobileVenueCard({
  venue,
  reviewers,
  users,
  canEdit
}: {
  venue: VenueRow;
  reviewers: ReviewerOption[];
  users: UserOption[];
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState(updateVenueAction, undefined);
  const [deleteState, deleteAction] = useActionState(deleteVenueAction, undefined);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const deleteFormRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const nameError = state?.fieldErrors?.name;
  const formId = `mobile-venue-form-${venue.id}`;
  const managerName = users.find((user) => user.id === venue.default_manager_responsible_id)?.name ?? "No default manager";
  const reviewerName = reviewers.find((reviewer) => reviewer.id === venue.default_approver_id)?.name ?? "No default reviewer";

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
    <article className="mobile-card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--navy)] text-sm font-semibold text-white">
              {venue.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-[var(--ink)]">{venue.name}</h2>
              <p className="text-sm text-[var(--ink-muted)]">{((venue as any).category ?? "pub")} · {Boolean((venue as any).is_internal) ? "Internal" : "Customer-facing"}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-[var(--ink-muted)]">{managerName} · {reviewerName}</p>
        </div>
        <Button asChild variant="secondary" size="sm" className="h-10 w-10 p-0" aria-label={`Opening hours for ${venue.name}`}>
          <Link href={`/venues/${venue.id}/opening-hours`}>
            <Clock className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>

      {canEdit ? (
        <details className="rounded-[8px] border border-[var(--hair)] bg-[var(--canvas-2)] p-3">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">Edit venue</summary>
          <form id={formId} action={formAction} className="mt-3 space-y-3" noValidate>
            <input type="hidden" name="venueId" value={venue.id} />
            <div className="space-y-1">
              <Label htmlFor={`mobile-venue-name-${venue.id}`}>Venue name</Label>
              <Input
                id={`mobile-venue-name-${venue.id}`}
                name="name"
                defaultValue={venue.name}
                required
                disabled={!canEdit}
                aria-invalid={Boolean(nameError)}
                className={cn("h-12 text-[16px]", nameError ? errorInputClass : undefined)}
              />
              <FieldError id={`mobile-venue-name-${venue.id}-error`} message={nameError} />
            </div>
            <div className="grid gap-3">
              <div className="space-y-1">
                <Label htmlFor={`mobile-venue-category-${venue.id}`}>Category</Label>
                <Select id={`mobile-venue-category-${venue.id}`} name="category" defaultValue={(venue as any).category ?? "pub"} className="h-12 text-[16px]">
                  <option value="pub">Pub</option>
                  <option value="cafe">Cafe</option>
                </Select>
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm text-[var(--ink)]">
                <input type="checkbox" name="isInternal" defaultChecked={Boolean((venue as any).is_internal)} className="h-4 w-4" />
                Internal venue
              </label>
              <div className="space-y-1">
                <Label htmlFor={`mobile-venue-manager-${venue.id}`}>Default manager</Label>
                <Select id={`mobile-venue-manager-${venue.id}`} name="defaultManagerResponsibleId" defaultValue={venue.default_manager_responsible_id ?? ""} className="h-12 text-[16px]">
                  <option value="">No default manager</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`mobile-venue-approver-${venue.id}`}>Default reviewer</Label>
                <Select id={`mobile-venue-approver-${venue.id}`} name="defaultApproverId" defaultValue={venue.default_approver_id ?? ""} className="h-12 text-[16px]">
                  <option value="">No default approver</option>
                  {reviewers.map((reviewer) => (
                    <option key={reviewer.id} value={reviewer.id}>{reviewer.name}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`mobile-venue-google-review-${venue.id}`}>Google Review URL</Label>
                <Input id={`mobile-venue-google-review-${venue.id}`} name="googleReviewUrl" type="url" defaultValue={venue.google_review_url ?? ""} className="h-12 text-[16px]" />
              </div>
            </div>
          </form>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button type="submit" variant="primary" className="h-11" form={formId}>
              <Save className="h-4 w-4" aria-hidden="true" />
              Save
            </Button>
            <form ref={deleteFormRef} action={deleteAction}>
              <input type="hidden" name="venueId" value={venue.id} />
              <Button type="button" variant="destructive" className="h-11 w-full" onClick={() => setDeleteConfirmOpen(true)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete
              </Button>
            </form>
          </div>
          <ConfirmDialog
            open={deleteConfirmOpen}
            title={`Delete ${venue.name}?`}
            description="This will permanently remove the venue. Events linked to it may be affected."
            confirmLabel="Delete"
            variant="danger"
            onConfirm={() => { setDeleteConfirmOpen(false); deleteFormRef.current?.requestSubmit(); }}
            onCancel={() => setDeleteConfirmOpen(false)}
          />
        </details>
      ) : null}
    </article>
  );
}

function VenueRowEditor({
  venue,
  reviewers,
  users,
  canEdit
}: {
  venue: VenueRow;
  reviewers: ReviewerOption[];
  users: UserOption[];
  canEdit: boolean;
}) {
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
    <tr className="border-t border-[var(--hair)]">
      <td colSpan={8} className="px-4 py-3">
        <div className="grid gap-3 md:grid-cols-[minmax(0,16fr)_minmax(0,10fr)_minmax(0,8fr)_minmax(0,16fr)_minmax(0,14fr)_minmax(0,24fr)_auto_auto] md:items-start">
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
                disabled={!canEdit}
              />
              <FieldError id={nameErrorId} message={nameError} />
            </div>
            <div className="space-y-2">
              <label className="sr-only" htmlFor={`venue-category-${venue.id}`}>
                Category
              </label>
              <Select
                id={`venue-category-${venue.id}`}
                name="category"
                 
                defaultValue={(venue as any).category ?? "pub"}
                disabled={!canEdit}
              >
                <option value="pub">🍺 Pub</option>
                <option value="cafe">☕ Cafe</option>
              </Select>
            </div>
            <div className="flex items-center">
              <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                <input
                  type="checkbox"
                  name="isInternal"
                  defaultChecked={Boolean((venue as any).is_internal)}
                  className="h-4 w-4"
                  disabled={!canEdit}
                />
                Internal
              </label>
            </div>
            <div className="space-y-2">
              <label className="sr-only" htmlFor={`venue-manager-${venue.id}`}>
                Default manager responsible
              </label>
              <Select
                id={`venue-manager-${venue.id}`}
                name="defaultManagerResponsibleId"
                defaultValue={venue.default_manager_responsible_id ?? ""}
                disabled={!canEdit}
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
              <Select
                id={`venue-approver-${venue.id}`}
                name="defaultApproverId"
                defaultValue={venue.default_approver_id ?? ""}
                disabled={!canEdit}
              >
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
                disabled={!canEdit}
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
            {canEdit ? (
              <>
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
              </>
            ) : null}
          </div>
        </div>
      </td>
    </tr>
  );
}
