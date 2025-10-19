"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { assignReviewerAction } from "@/actions/reviewers";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

type EventOption = {
  id: string;
  label: string;
};

type ReviewerOption = {
  id: string;
  label: string;
};

type AssignReviewerFormProps = {
  events: EventOption[];
  reviewers: ReviewerOption[];
};

type AssignReviewerState =
  | Awaited<ReturnType<typeof assignReviewerAction>>
  | undefined;

const initialState: AssignReviewerState = undefined;

const assignReviewerHandler = async (
  _state: AssignReviewerState,
  formData: FormData
) => {
  const result = await assignReviewerAction(formData);
  return result ?? undefined;
};

export function AssignReviewerForm({
  events,
  reviewers,
}: AssignReviewerFormProps) {
  const [state, dispatch] = useActionState(assignReviewerHandler, initialState);

  const hasEvents = events.length > 0;
  const hasReviewers = reviewers.length > 0;

  return (
    <form
      action={dispatch}
      className="grid gap-4 md:grid-cols-[2fr_2fr_1.5fr]"
    >
      <div className="space-y-2">
        <label
          htmlFor="eventId"
          className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle"
        >
          Event
        </label>
        <Select
          id="eventId"
          name="eventId"
          defaultValue={hasEvents ? events[0]?.id : ""}
          disabled={!hasEvents}
        >
          {hasEvents ? (
            events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.label}
              </option>
            ))
          ) : (
            <option value="">No events available</option>
          )}
        </Select>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="reviewerId"
          className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle"
        >
          Reviewer
        </label>
        <Select
          id="reviewerId"
          name="reviewerId"
          defaultValue={hasReviewers ? reviewers[0]?.id : ""}
          disabled={!hasReviewers}
        >
          {hasReviewers ? (
            reviewers.map((reviewer) => (
              <option key={reviewer.id} value={reviewer.id}>
                {reviewer.label}
              </option>
            ))
          ) : (
            <option value="">No reviewers available</option>
          )}
        </Select>
      </div>

      <div className="flex flex-col justify-end gap-2">
        <SubmitButton disabled={!hasEvents || !hasReviewers} />
        <p className="text-xs text-subtle">
          Success returns you to this page with a confirmation banner.
        </p>
      </div>

      {state?.error ? (
        <Alert variant="danger" title={state.error} className="md:col-span-3" />
      ) : null}
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "Assigning..." : "Assign reviewer"}
    </Button>
  );
}
