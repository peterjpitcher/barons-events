"use client";

import { useActionState, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useFormStatus } from "react-dom";
import { reviewerDecisionAction } from "@/actions/reviewers";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { Alert } from "@/components/ui/alert";

type DecisionFormProps = {
  eventId: string;
  triggerLabel?: string;
};

type DecisionFormState =
  | Awaited<ReturnType<typeof reviewerDecisionAction>>
  | undefined;

const initialState: DecisionFormState = undefined;

const decisionActionHandler = async (
  _state: DecisionFormState,
  formData: FormData
) => {
  const result = await reviewerDecisionAction(formData);
  return result ?? undefined;
};

type DecisionTemplate = {
  value: string;
  label: string;
  note: string;
};

export const DECISION_TEMPLATES: ReadonlyArray<DecisionTemplate> = [
  {
    value: "",
    label: "Write custom feedback",
    note: "",
  },
  {
    value: "approved_ready",
    label: "Approved – ready to publish",
    note: "Approved as submitted. Publishing flow clear to proceed.",
  },
  {
    value: "needs_more_detail",
    label: "Needs revisions – add more detail",
    note: "Please expand on the promotions section and confirm staffing before resubmitting.",
  },
  {
    value: "reject_conflict",
    label: "Rejected – conflicting event",
    note: "Rejecting due to a scheduling clash. Coordinate with central planning to find an alternative date.",
  },
];

export function DecisionForm({ eventId, triggerLabel = "Record decision" }: DecisionFormProps) {
  const [state, dispatch] = useActionState(decisionActionHandler, initialState);
  const [isOpen, setIsOpen] = useState(false);
  const [decision, setDecision] = useState<"approved" | "needs_revisions" | "rejected">(
    "approved"
  );
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (state?.error) {
      setIsSubmitting(false);
    }
  }, [state?.error]);

  const currentTemplate = useMemo(
    () => DECISION_TEMPLATES.find((template) => template.value === selectedTemplate),
    [selectedTemplate]
  );

  const handleTemplateChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setSelectedTemplate(value);
    const template = DECISION_TEMPLATES.find((item) => item.value === value);
    if (template) {
      setNote(template.note);
    } else {
      setNote("");
    }
  };

  const handleNoteChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setNote(event.target.value);
    if (selectedTemplate) {
      setSelectedTemplate("");
    }
  };

  const closeModal = () => {
    if (isSubmitting) return;
    setIsOpen(false);
    setDecision("approved");
    setSelectedTemplate("");
    setNote("");
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setIsOpen(true)}>
        {triggerLabel}
      </Button>

      <Modal open={isOpen} onClose={closeModal} title="Record reviewer decision">
        <form
          action={dispatch}
          onSubmit={() => setIsSubmitting(true)}
          className="space-y-5"
        >
          <input type="hidden" name="eventId" value={eventId} />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor={`decision-${eventId}`}
                className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle"
              >
                Decision
              </label>
              <Select
                id={`decision-${eventId}`}
                name="decision"
                value={decision}
                onChange={(event) =>
                  setDecision(event.target.value as "approved" | "needs_revisions" | "rejected")
                }
              >
                <option value="approved">Approve</option>
                <option value="needs_revisions">Needs revisions</option>
                <option value="rejected">Reject</option>
              </Select>
            </div>

            <div className="space-y-2">
              <label
                htmlFor={`template-${eventId}`}
                className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle"
              >
                Feedback template
              </label>
              <Select
                id={`template-${eventId}`}
                value={selectedTemplate}
                onChange={handleTemplateChange}
              >
                {DECISION_TEMPLATES.map((template) => (
                  <option key={template.value} value={template.value}>
                    {template.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor={`note-${eventId}`}
              className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle"
            >
              Reviewer note
            </label>
            <Textarea
              id={`note-${eventId}`}
              name="note"
              rows={4}
              value={note}
              placeholder="Share context the venue manager needs to action."
              onChange={handleNoteChange}
            />
            {currentTemplate && currentTemplate.value ? (
              <p className="text-xs text-subtle">
                Template applied: {currentTemplate.label}
              </p>
            ) : (
              <p className="text-xs text-subtle">
                Notes are optional but help track rationale in the audit log.
              </p>
            )}
          </div>

          {state?.error ? <Alert variant="danger" title={state.error} /> : null}

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={closeModal}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <SubmitButton />
          </div>
        </form>
      </Modal>
    </>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving..." : "Record decision"}
    </Button>
  );
}
