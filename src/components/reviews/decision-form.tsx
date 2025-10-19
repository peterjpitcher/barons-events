"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { reviewerDecisionAction } from "@/actions/events";
import { SubmitButton } from "@/components/ui/submit-button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const decisions = [
  { value: "approved", label: "Approve" },
  { value: "needs_revisions", label: "Needs tweaks" },
  { value: "rejected", label: "Reject" }
];

type DecisionFormProps = {
  eventId: string;
};

export function DecisionForm({ eventId }: DecisionFormProps) {
  const [state, formAction] = useActionState(reviewerDecisionAction, undefined);

  useEffect(() => {
    if (state?.message) {
      if (state.success) {
        toast.success(state.message);
      } else {
        toast.error(state.message);
      }
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="eventId" value={eventId} />
      <fieldset className="space-y-2">
        <Label className="text-sm font-semibold text-[var(--color-text)]">Decision</Label>
        <div className="flex flex-wrap gap-3">
          {decisions.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded-full border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] shadow-soft hover:border-[var(--color-primary-500)]"
            >
              <input type="radio" name="decision" value={option.value} className="h-4 w-4" required />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="feedback">Feedback (optional)</Label>
        <Textarea id="feedback" name="feedback" rows={4} placeholder="Share clear next steps or approval notes." />
      </div>
      <SubmitButton label="Record decision" pendingLabel="Saving..." variant="primary" />
    </form>
  );
}
