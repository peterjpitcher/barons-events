"use client";

import { useFormState, useFormStatus } from "react-dom";
import { reviewerDecisionAction } from "@/actions/reviewers";

type DecisionFormProps = {
  eventId: string;
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

export function DecisionForm({ eventId }: DecisionFormProps) {
  const [state, dispatch] = useFormState(decisionActionHandler, initialState);

  return (
    <div className="flex flex-col gap-1">
      <form
        action={dispatch}
        className="flex items-center gap-2"
      >
        <input type="hidden" name="eventId" value={eventId} />
        <select
          name="decision"
          className="rounded-lg border border-black/10 px-2 py-1 text-xs text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
          defaultValue="approved"
        >
          <option value="approved">Approve</option>
          <option value="needs_revisions">Needs revisions</option>
          <option value="rejected">Reject</option>
        </select>
        <input
          name="note"
          type="text"
          placeholder="Optional note"
          className="w-32 rounded-lg border border-black/10 px-2 py-1 text-xs text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
        />
        <SubmitButton />
      </form>
      {state?.error ? (
        <p className="text-xs text-red-600">{state.error}</p>
      ) : null}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40 disabled:opacity-60"
      disabled={pending}
    >
      {pending ? "Saving..." : "Record"}
    </button>
  );
}
