"use client";

import { useActionState, useEffect, useRef } from "react";
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
import type { Database } from "@/lib/supabase/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/ui/submit-button";

type VenueArea = Database["public"]["Tables"]["venue_areas"]["Row"];

type VenuesManagerProps = {
  venues: VenueWithAreas[];
};

export function VenuesManager({ venues }: VenuesManagerProps) {
  return (
    <div className="space-y-6">
      <VenueCreateForm />
      <div className="grid gap-4 md:grid-cols-2">
        {venues.map((venue) => (
          <VenueCard key={venue.id} venue={venue} />
        ))}
        {venues.length === 0 ? (
          <Card className="md:col-span-2">
            <CardContent className="py-8 text-center text-subtle">
              No venues yet. Add your first location above.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function VenueCreateForm() {
  const [state, formAction] = useActionState(createVenueAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      formRef.current?.reset();
      router.refresh();
    } else {
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
        <form ref={formRef} action={formAction} className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="new-venue-name">Venue name</Label>
            <Input id="new-venue-name" name="name" placeholder="Barons Riverside" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-venue-address">Address</Label>
            <Textarea id="new-venue-address" name="address" rows={3} placeholder="12 River Walk, Guildford" />
          </div>
          <SubmitButton label="Add venue" pendingLabel="Saving..." />
        </form>
      </CardContent>
    </Card>
  );
}

function VenueCard({ venue }: { venue: VenueWithAreas }) {
  const [state, formAction] = useActionState(updateVenueAction, undefined);
  const [deleteState, deleteAction] = useActionState(deleteVenueAction, undefined);
  const router = useRouter();

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      router.refresh();
    } else {
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
        <form action={formAction} className="grid gap-4">
          <input type="hidden" name="venueId" value={venue.id} />
          <div className="space-y-2">
            <Label htmlFor={`venue-name-${venue.id}`}>Venue name</Label>
            <Input id={`venue-name-${venue.id}`} name="name" defaultValue={venue.name} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`venue-address-${venue.id}`}>Address</Label>
            <Textarea
              id={`venue-address-${venue.id}`}
              name="address"
              rows={3}
              defaultValue={venue.address ?? ""}
              placeholder="Street, town, postcode"
            />
          </div>
          <SubmitButton label="Save venue" pendingLabel="Saving..." />
        </form>
        <VenueAreas venueId={venue.id} areas={venue.areas} />
        <form action={deleteAction} className="inline-flex">
          <input type="hidden" name="venueId" value={venue.id} />
          <SubmitButton label="Remove venue" pendingLabel="Removing..." variant="destructive" />
        </form>
      </CardContent>
    </Card>
  );
}

function VenueAreas({ venueId, areas }: { venueId: string; areas: VenueArea[] }) {
  const [state, formAction] = useActionState(createVenueAreaAction, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      formRef.current?.reset();
      router.refresh();
    } else {
      toast.error(state.message);
    }
  }, [state, router]);

  return (
    <div className="space-y-4 rounded-[var(--radius)] border border-[var(--color-border)] bg-white/70 p-4">
      <div>
        <h4 className="text-sm font-semibold text-[var(--color-primary-700)]">Venue areas</h4>
        <p className="text-xs text-subtle">
          Add every bookable space with its own capacity so planners can balance the load.
        </p>
      </div>
      <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="venueId" value={venueId} />
        <div className="flex-1 min-w-[160px] space-y-2">
          <Label htmlFor={`new-area-name-${venueId}`}>Area name</Label>
          <Input id={`new-area-name-${venueId}`} name="name" placeholder="Main Bar" required />
        </div>
        <div className="w-32 space-y-2">
          <Label htmlFor={`new-area-capacity-${venueId}`}>Capacity</Label>
          <Input id={`new-area-capacity-${venueId}`} name="capacity" type="number" min={0} placeholder="120" />
        </div>
        <SubmitButton label="Add area" pendingLabel="Saving..." />
      </form>
      <div className="space-y-3">
        {areas.length === 0 ? (
          <p className="text-sm text-subtle">No areas yet. Add the core spaces above.</p>
        ) : (
          areas.map((area) => <VenueAreaRow key={area.id} area={area} venueId={venueId} />)
        )}
      </div>
    </div>
  );
}

function VenueAreaRow({ area, venueId }: { area: VenueArea; venueId: string }) {
  const [state, formAction] = useActionState(updateVenueAreaAction, undefined);
  const [deleteState, deleteAction] = useActionState(deleteVenueAreaAction, undefined);
  const router = useRouter();

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      router.refresh();
    } else {
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
    <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="areaId" value={area.id} />
        <input type="hidden" name="venueId" value={venueId} />
        <div className="flex-1 min-w-[160px] space-y-2">
          <Label htmlFor={`area-name-${area.id}`}>Area name</Label>
          <Input id={`area-name-${area.id}`} name="name" defaultValue={area.name} required />
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
        <SubmitButton label="Save area" pendingLabel="Saving..." />
      </form>
      <form action={deleteAction} className="mt-3 inline-flex">
        <input type="hidden" name="areaId" value={area.id} />
        <SubmitButton label="Remove area" pendingLabel="Removing..." variant="destructive" />
      </form>
    </div>
  );
}
