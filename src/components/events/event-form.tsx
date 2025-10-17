"use client";

import { useFormState } from "react-dom";
import { createEventDraftAction } from "@/actions/events";

type VenueOption = {
  id: string;
  name: string;
};

type EventFormProps = {
  venues: VenueOption[];
};

type EventFormState = Awaited<ReturnType<typeof createEventDraftAction>>;

const initialState: EventFormState = undefined;

const draftActionHandler = async (
  _state: EventFormState | undefined,
  formData: FormData
) =>
  (await createEventDraftAction(formData)) as EventFormState | undefined;

export function EventForm({ venues }: EventFormProps) {
  const [state, dispatch] = useFormState(draftActionHandler, initialState);

  const hasVenues = venues.length > 0;

  return (
    <form
      action={dispatch}
      className="space-y-6 rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm"
    >
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-black">
          Create event draft
        </h2>
        <p className="text-sm text-black/70">
          Start with a working title, venue, and dates. The draft stays private
          until you submit it for review.
        </p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="title"
          className="text-sm font-medium text-black/80"
        >
          Event title
        </label>
        <input
          id="title"
          name="title"
          required
          placeholder="Summer beer festival"
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
        />
        {state?.fieldErrors?.title ? (
          <p className="text-xs text-red-600">{state.fieldErrors.title}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label
            htmlFor="venueId"
            className="text-sm font-medium text-black/80"
          >
            Venue
          </label>
          <select
            id="venueId"
            name="venueId"
            defaultValue={hasVenues ? venues[0]?.id : ""}
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
            disabled={!hasVenues}
          >
            {hasVenues ? (
              venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))
            ) : (
              <option>Select a venue</option>
            )}
          </select>
          {state?.fieldErrors?.venueId ? (
            <p className="text-xs text-red-600">{state.fieldErrors.venueId}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="startAt"
            className="text-sm font-medium text-black/80"
          >
            Start date &amp; time
          </label>
          <input
            id="startAt"
            name="startAt"
            type="datetime-local"
            required
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
          />
          {state?.fieldErrors?.startAt ? (
            <p className="text-xs text-red-600">{state.fieldErrors.startAt}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="endAt"
          className="text-sm font-medium text-black/80"
        >
          End date &amp; time (optional)
        </label>
        <input
          id="endAt"
          name="endAt"
          type="datetime-local"
          className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
        />
        {state?.fieldErrors?.endAt ? (
          <p className="text-xs text-red-600">{state.fieldErrors.endAt}</p>
        ) : null}
      </div>

      {state?.error ? (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
          disabled={!hasVenues}
        >
          Save draft
        </button>
        <span className="text-xs text-black/50">
          Drafts stay private until submitted for review.
        </span>
      </div>
    </form>
  );
}
