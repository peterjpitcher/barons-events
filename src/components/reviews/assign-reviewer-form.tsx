"use client";

import { useFormState, useFormStatus } from "react-dom";
import { assignReviewerAction } from "@/actions/reviewers";

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
  const [state, dispatch] = useFormState(
    assignReviewerHandler,
    initialState
  );

  const hasEvents = events.length > 0;
  const hasReviewers = reviewers.length > 0;

  return (
    <form
      action={dispatch}
      className="mt-6 grid gap-4 sm:grid-cols-3"
    >
      <div className="space-y-2 sm:col-span-1">
        <label
          htmlFor="eventId"
          className="text-xs font-medium uppercase tracking-wide text-black/50"
        >
          Event
        </label>
        <select
          id="eventId"
          name="eventId"
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
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
            <option value="">No events</option>
          )}
        </select>
      </div>

      <div className="space-y-2 sm:col-span-1">
        <label
          htmlFor="reviewerId"
          className="text-xs font-medium uppercase tracking-wide text-black/50"
        >
          Reviewer
        </label>
        <select
          id="reviewerId"
          name="reviewerId"
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
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
            <option value="">No reviewers</option>
          )}
        </select>
      </div>

      <div className="sm:col-span-1 sm:flex sm:flex-col sm:justify-end">
        <SubmitButton
          disabled={!hasEvents || !hasReviewers}
        />
        <p className="mt-2 text-xs text-black/50">
          Success returns you to this page with a confirmation banner.
        </p>
      </div>

      {state?.error ? (
        <div className="sm:col-span-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="inline-flex w-full items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40 disabled:opacity-60"
      disabled={disabled || pending}
    >
      {pending ? "Assigning..." : "Assign reviewer"}
    </button>
  );
}
