"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { generateWebsiteCopyAction, reviewerDecisionAction } from "@/actions/events";
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
  const [websiteCopyState, websiteCopyAction] = useActionState(generateWebsiteCopyAction, undefined);
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null);
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

  useEffect(() => {
    if (websiteCopyState?.message) {
      if (websiteCopyState.success) {
        toast.success(websiteCopyState.message);
      } else if (!websiteCopyState.fieldErrors) {
        toast.error(websiteCopyState.message);
      }
    }
  }, [websiteCopyState]);

  useEffect(() => {
    if (!state?.success) return;
    if (selectedDecision !== "approved") return;

    const confirmed = window.confirm("Event approved. Generate the AI website listing copy now?");
    if (!confirmed) return;

    const formData = new FormData();
    formData.set("eventId", eventId);
    websiteCopyAction(formData);
  }, [eventId, selectedDecision, state?.success, websiteCopyAction]);

  useEffect(() => {
    if (!websiteCopyState?.success) return;

    const websiteCopyCard = document.getElementById("website-copy");
    if (websiteCopyCard) {
      websiteCopyCard.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const url = `/events/${eventId}#website-copy`;
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.location.assign(url);
    }
  }, [eventId, websiteCopyState?.success]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="eventId" value={eventId} />
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
