"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteEventButton } from "@/components/events/delete-event-button";
import { useEventFormContext } from "@/components/events/event-form-context";

type EventFormActionsProps = {
  eventId?: string;
  canDelete?: boolean;
};

export function EventFormActions({ eventId, canDelete }: EventFormActionsProps) {
  const { saveDraft, submitForReview, isSaving, isSubmitting, isPending, mode } =
    useEventFormContext();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={isPending}
          onClick={saveDraft}
          className="w-full justify-center"
        >
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {isSaving ? "Saving..." : mode === "create" ? "Save draft" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={submitForReview}
          className="w-full justify-center"
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          {isSubmitting ? "Submitting..." : "Submit for review"}
        </Button>
      </div>

      {canDelete && eventId ? (
        <div className="border-t border-[var(--color-border)] pt-4">
          <p className="mb-2 text-xs font-medium text-red-600">Danger zone</p>
          <DeleteEventButton eventId={eventId} />
        </div>
      ) : null}
    </div>
  );
}
