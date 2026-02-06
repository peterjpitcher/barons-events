"use client";

import { useActionState, useEffect, useRef, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createVenueAction,
  updateVenueAction,
  deleteVenueAction,
  createVenueAreaAction,
  updateVenueAreaAction,
  deleteVenueAreaAction
} from "@/actions/venues";
import type { VenueWithAreas } from "@/lib/venues";
import type { ReviewerOption } from "@/lib/reviewers";
import type { Database } from "@/lib/supabase/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Loader2, Save, Trash2, Plus } from "lucide-react";
import { Select } from "@/components/ui/select";
import { FieldError } from "@/components/ui/field-error";

type VenueArea = Database["public"]["Tables"]["venue_areas"]["Row"];

type VenuesManagerProps = {
  venues: VenueWithAreas[];
  reviewers: ReviewerOption[];
};

const errorInputClass = "!border-[var(--color-danger)] focus-visible:!border-[var(--color-danger)]";

export function VenuesManager({ venues, reviewers }: VenuesManagerProps) {
  return (
    <div className="space-y-6">
      <VenueCreateForm reviewers={reviewers} />
      <div className="space-y-4">
        <div className="grid gap-4 md:hidden">
          {venues.map((venue) => (
            <VenueCardMobile key={venue.id} venue={venue} reviewers={reviewers} />
          ))}
          {venues.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-subtle">
                No venues yet. Add your first location above.
              </CardContent>
            </Card>
          ) : null}
        </div>
        <VenueDesktopList venues={venues} reviewers={reviewers} />
      </div>
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
        <CardDescription>Keep the basics tidy so planners and managers pick the right site.</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="grid gap-4" noValidate>
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
            <p className="text-xs text-subtle">When new events are submitted, they’ll be routed to this reviewer first.</p>
          </div>
          <div className="flex justify-end">
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

function VenueCardMobile({ venue, reviewers }: { venue: VenueWithAreas; reviewers: ReviewerOption[] }) {
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
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-xl text-[var(--color-primary-700)]">{venue.name}</CardTitle>
        <CardDescription>Update details or remove the venue if it’s no longer in use.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <form action={formAction} className="grid gap-4" noValidate>
          <input type="hidden" name="venueId" value={venue.id} />
          <div className="space-y-2">
            <Label htmlFor={`venue-name-${venue.id}`}>Venue name</Label>
            <Input
              id={`venue-name-${venue.id}`}
              name="name"
              defaultValue={venue.name}
              required
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? nameErrorId : undefined}
              className={nameError ? errorInputClass : undefined}
            />
            <FieldError id={nameErrorId} message={nameError} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`venue-default-${venue.id}`}>Default reviewer</Label>
            <Select
              id={`venue-default-${venue.id}`}
              name="defaultReviewerId"
              defaultValue={venue.default_reviewer_id ?? ""}
            >
              <option value="">No default reviewer</option>
              {reviewers.map((reviewer) => (
                <option key={reviewer.id} value={reviewer.id}>
                  {reviewer.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-subtle">Choose who receives submissions from this site by default.</p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <SubmitButton
              label="Remove venue"
              pendingLabel="Removing..."
              variant="destructive"
              icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              formAction={deleteAction}
              formNoValidate
              hideLabel
            />
            <SubmitButton
              label="Save venue"
              pendingLabel="Saving..."
              icon={<Save className="h-4 w-4" aria-hidden="true" />}
              hideLabel
            />
          </div>
        </form>
        <VenueAreas venueId={venue.id} areas={venue.areas} />
      </CardContent>
    </Card>
  );
}

function VenueDesktopList({ venues, reviewers }: VenuesManagerProps) {
  if (venues.length === 0) {
    return (
      <div className="hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-white py-8 text-center text-subtle md:block">
        No venues yet. Add your first location above.
      </div>
    );
  }

  return (
    <div className="hidden overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-white md:block">
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_auto] gap-4 border-b border-[var(--color-border)] bg-[var(--color-muted-surface)] px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-subtle">
        <div>Venue</div>
        <div>Spaces</div>
        <div className="text-right">Actions</div>
      </div>
      <ul>
        {venues.map((venue, index) => (
          <VenueDesktopRow key={venue.id} venue={venue} reviewers={reviewers} isFirst={index === 0} />
        ))}
      </ul>
    </div>
  );
}

function VenueDesktopRow({ venue, reviewers, isFirst }: { venue: VenueWithAreas; reviewers: ReviewerOption[]; isFirst: boolean }) {
  const [state, formAction] = useActionState(updateVenueAction, undefined);
  const [deleteState, deleteAction] = useActionState(deleteVenueAction, undefined);
  const router = useRouter();
  const nameError = state?.fieldErrors?.name;
  const nameErrorId = `venue-name-desktop-${venue.id}-error`;

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
    <li
      className={`border-[var(--color-border)] px-6 py-5 ${isFirst ? "border-b" : "border-y"} hover:bg-[rgba(39,54,64,0.03)]`}
    >
      <form action={formAction} className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_auto] items-start gap-4" noValidate>
        <input type="hidden" name="venueId" value={venue.id} />
        <div className="flex flex-col gap-2">
          <label className="sr-only" htmlFor={`venue-name-desktop-${venue.id}`}>
            Venue name
          </label>
          <Input
            id={`venue-name-desktop-${venue.id}`}
            name="name"
            defaultValue={venue.name}
            required
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? nameErrorId : undefined}
            className={nameError ? errorInputClass : undefined}
          />
          <FieldError id={nameErrorId} message={nameError} />
        </div>
        <div className="space-y-3 text-sm text-subtle">
          <div>
            <span>{venue.areas.length ? `${venue.areas.length} space${venue.areas.length === 1 ? "" : "s"}` : "No spaces yet"}</span>
            {venue.areas.length ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                {venue.areas.map((area) => area.name).join(", ")}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`venue-default-desktop-${venue.id}`} className="text-[0.7rem] uppercase tracking-[0.2em] text-subtle">
              Default reviewer
            </Label>
            <Select
              id={`venue-default-desktop-${venue.id}`}
              name="defaultReviewerId"
              defaultValue={venue.default_reviewer_id ?? ""}
            >
              <option value="">No default reviewer</option>
              {reviewers.map((reviewer) => (
                <option key={reviewer.id} value={reviewer.id}>
                  {reviewer.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <SubmitButton
            label="Remove venue"
            pendingLabel="Removing..."
            variant="destructive"
            icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
            formAction={deleteAction}
            formNoValidate
            hideLabel
          />
          <SubmitButton
            label="Save changes"
            pendingLabel="Saving..."
            icon={<Save className="h-4 w-4" aria-hidden="true" />}
            hideLabel
          />
        </div>
      </form>
      <VenueAreas venueId={venue.id} areas={venue.areas} variant="list" />
    </li>
  );
}

function VenueAreas({
  venueId,
  areas,
  variant = "card"
}: {
  venueId: string;
  areas: VenueArea[];
  variant?: "card" | "list";
}) {
  const [state, formAction] = useActionState(createVenueAreaAction, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const nameError = state?.fieldErrors?.name;
  const nameErrorId = `new-area-name-${venueId}-error`;

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

  const containerClass =
    variant === "card"
      ? "space-y-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-white/70 p-4"
      : "mt-5 space-y-4 border-t border-[var(--color-border)] pt-5";

  return (
    <div className={containerClass}>
      <div>
        <h4 className="text-sm font-semibold text-[var(--color-primary-700)]">Venue areas</h4>
        <p className="text-xs text-subtle">
          Add every bookable space with its own capacity so planners can balance the load.
        </p>
      </div>
      <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3" noValidate>
        <input type="hidden" name="venueId" value={venueId} />
        <div className="flex-1 min-w-[160px] space-y-2">
          <Label htmlFor={`new-area-name-${venueId}`}>Area name</Label>
          <Input
            id={`new-area-name-${venueId}`}
            name="name"
            placeholder="Main Bar"
            required
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? nameErrorId : undefined}
            className={nameError ? errorInputClass : undefined}
          />
          <FieldError id={nameErrorId} message={nameError} />
        </div>
        <div className="w-32 space-y-2">
          <Label htmlFor={`new-area-capacity-${venueId}`}>Capacity</Label>
          <Input id={`new-area-capacity-${venueId}`} name="capacity" type="number" min={0} placeholder="120" />
        </div>
        <SubmitButton
          label="Add area"
          pendingLabel="Saving..."
          icon={<Plus className="h-4 w-4" aria-hidden="true" />}
          hideLabel
        />
      </form>
      <div className="space-y-3">
        {areas.length === 0 ? (
          <p className="text-sm text-subtle">No areas yet. Add the core spaces above.</p>
        ) : (
          areas.map((area) => <VenueAreaRow key={area.id} area={area} venueId={venueId} variant={variant} />)
        )}
      </div>
    </div>
  );
}

function VenueAreaRow({
  area,
  venueId,
  variant = "card"
}: {
  area: VenueArea;
  venueId: string;
  variant?: "card" | "list";
}) {
  const [state, formAction] = useActionState(updateVenueAreaAction, undefined);
  const [deleteState, deleteAction] = useActionState(deleteVenueAreaAction, undefined);
  const router = useRouter();
  const nameError = state?.fieldErrors?.name;
  const nameErrorId = `area-name-${area.id}-error`;

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

  const containerClass =
    variant === "card"
      ? "rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-4"
      : "rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[rgba(39,54,64,0.04)] p-3";

  return (
    <div className={containerClass}>
      <div className="flex flex-wrap items-end gap-3">
        <form action={formAction} className="flex flex-1 flex-wrap items-end gap-3" noValidate>
          <input type="hidden" name="areaId" value={area.id} />
          <input type="hidden" name="venueId" value={venueId} />
          <div className="flex-1 min-w-[160px] space-y-2">
            <Label htmlFor={`area-name-${area.id}`}>Area name</Label>
            <Input
              id={`area-name-${area.id}`}
              name="name"
              defaultValue={area.name}
              required
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? nameErrorId : undefined}
              className={nameError ? errorInputClass : undefined}
            />
            <FieldError id={nameErrorId} message={nameError} />
          </div>
          <div className="w-32 space-y-2">
            <Label htmlFor={`area-capacity-${area.id}`}>Capacity</Label>
            <Input
              id={`area-capacity-${area.id}`}
              name="capacity"
              type="number"
              min={0}
              defaultValue={area.capacity ?? ""}
              placeholder="120"
            />
          </div>
          <IconSubmitButton label="Save area" pendingLabel="Saving..." icon={Save} />
        </form>
        <form action={deleteAction} className="flex items-end">
          <input type="hidden" name="areaId" value={area.id} />
          <IconSubmitButton label="Remove area" pendingLabel="Removing..." icon={Trash2} variant="destructive" />
        </form>
      </div>
    </div>
  );
}

type IconSubmitButtonProps = {
  label: string;
  pendingLabel?: string;
  icon: LucideIcon;
} & Omit<ComponentProps<typeof Button>, "type" | "size" | "children">;

function IconSubmitButton({ label, pendingLabel = "Please wait...", icon: Icon, variant = "primary", className, ...props }: IconSubmitButtonProps) {
  const { pending } = useFormStatus();
  const pendingText = pendingLabel ?? label;

  return (
    <Button
      type="submit"
      variant={variant}
      size="icon"
      className={cn("gap-0", className)}
      aria-label={label}
      {...props}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Icon className="h-4 w-4" aria-hidden="true" />
      )}
      <span className="sr-only">{pending ? pendingText : label}</span>
    </Button>
  );
}
