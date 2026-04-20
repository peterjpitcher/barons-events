"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { proposeEventAction } from "@/actions/pre-event";
import { VenueMultiSelect, type VenueOption } from "@/components/venues/venue-multi-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";

type ProposeEventFormProps = {
  venues: VenueOption[];
  /**
   * Optional pre-selected venue id. When provided and matching a venue in
   * `venues`, the form opens with that venue already ticked. Used to give
   * office workers a sensible default without restricting the picker.
   */
  defaultVenueId?: string | null;
};

export function ProposeEventForm({ venues, defaultVenueId }: ProposeEventFormProps) {
  const [state, formAction] = useActionState(proposeEventAction, undefined);
  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>(() => {
    if (defaultVenueId && venues.some((v) => v.id === defaultVenueId)) {
      return [defaultVenueId];
    }
    return venues.length === 1 ? [venues[0].id] : [];
  });
  const router = useRouter();

  useEffect(() => {
    if (state?.message) {
      if (state.success) {
        toast.success(state.message);
        router.push("/events");
      } else {
        toast.error(state.message);
      }
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="propose-title">Event title</Label>
        <Input id="propose-title" name="title" required maxLength={200} placeholder="e.g. Easter Weekend Quiz" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="propose-start">When is it?</Label>
        <Input id="propose-start" name="startAt" type="datetime-local" required />
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium text-[var(--color-text)]">Which venues?</span>
        <VenueMultiSelect
          venues={venues}
          selectedIds={selectedVenueIds}
          onChange={setSelectedVenueIds}
          hiddenFieldName="venueIds"
        />
        {selectedVenueIds.length === 0 ? (
          <p className="text-xs text-[var(--color-danger)]">Pick at least one venue.</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="propose-notes">Short description</Label>
        <Textarea
          id="propose-notes"
          name="notes"
          rows={4}
          required
          maxLength={2000}
          placeholder="A sentence or two about the idea — the admin will use this to decide whether to green-light it."
        />
      </div>

      <SubmitButton
        label="Submit proposal"
        pendingLabel="Submitting..."
        variant="primary"
      />
    </form>
  );
}
