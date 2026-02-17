"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { reviewerDecisionAction } from "@/actions/events";
import { SubmitButton } from "@/components/ui/submit-button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/ui/field-error";

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
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null);
  const generateWebsiteCopyInputRef = useRef<HTMLInputElement | null>(null);
  const decisionError = state?.fieldErrors?.decision;

  useEffect(() => {
    if (state?.message) {
      if (state.success) {
        toast.success(state.message);
      } else if (!state.fieldErrors) {
        toast.error(state.message);
      }
    }
  }, [state]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (generateWebsiteCopyInputRef.current) {
      generateWebsiteCopyInputRef.current.value = "false";
    }

    if (selectedDecision !== "approved") return;

    const confirmed = window.confirm(
      "Approving this event requires generating AI website listing copy now. Continue?"
    );
    if (!confirmed) {
      event.preventDefault();
      return;
    }

    if (generateWebsiteCopyInputRef.current) {
      generateWebsiteCopyInputRef.current.value = "true";
    }
  }

  return (
    <form action={formAction} className="space-y-4" noValidate onSubmit={handleSubmit}>
      <input type="hidden" name="eventId" value={eventId} />
      <input ref={generateWebsiteCopyInputRef} type="hidden" name="generateWebsiteCopy" value="false" />
      <fieldset className="space-y-2" aria-describedby={decisionError ? "decision-error" : undefined}>
        <Label className="text-sm font-semibold text-[var(--color-text)]">Decision</Label>
        <div className="flex flex-wrap gap-3">
          {decisions.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded-full border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] shadow-soft hover:border-[var(--color-primary-500)]"
            >
              <input
                type="radio"
                name="decision"
                value={option.value}
                className="h-4 w-4"
                required
                aria-invalid={Boolean(decisionError)}
                aria-describedby={decisionError ? "decision-error" : undefined}
                onChange={() => setSelectedDecision(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
        <FieldError id="decision-error" message={decisionError} />
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="feedback">Feedback (optional)</Label>
        <Textarea id="feedback" name="feedback" rows={4} placeholder="Share clear next steps or approval notes." />
      </div>
      <SubmitButton label="Record decision" pendingLabel="Saving..." variant="primary" />
    </form>
  );
}
