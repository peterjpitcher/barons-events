"use client";

import { useMemo } from "react";
import { useFormState } from "react-dom";
import { cloneEventAction, type CloneEventState } from "@/actions/events";
import type { EventSummary } from "@/lib/events/analytics";

type EventClonePanelProps = {
  events: EventSummary[];
};

const initialState: CloneEventState = {};

export function EventClonePanel({ events }: EventClonePanelProps) {
  const sortedDraftables = useMemo(() => {
    return events
      .filter((event) =>
        ["draft", "submitted", "needs_revisions", "approved", "published"].includes(
          event.status
        )
      )
      .sort((a, b) => {
        const aStart = a.startAt ? new Date(a.startAt).getTime() : Number.NEGATIVE_INFINITY;
        const bStart = b.startAt ? new Date(b.startAt).getTime() : Number.NEGATIVE_INFINITY;
        return bStart - aStart;
      });
  }, [events]);

  const [state, dispatch] = useFormState<CloneEventState, FormData>(
    async (_, formData) => (await cloneEventAction(formData)) ?? initialState,
    initialState
  );

  return (
    <div className="space-y-4 rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-black">Clone existing event</h2>
        <p className="text-sm text-black/70">
          Create a draft copy seeded with the latest submission payload. Update dates and details
          before re-submitting.
        </p>
      </header>

      <form action={dispatch} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="eventId" className="text-sm font-medium text-black/80">
            Select event to clone
          </label>
          <select
            id="eventId"
            name="eventId"
            defaultValue=""
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
            required
          >
            <option value="" disabled>
              Choose an event
            </option>
            {sortedDraftables.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title} · {event.venueName ?? "Unknown venue"}
              </option>
            ))}
          </select>
        </div>

        {state.error ? (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
          >
            Clone event
          </button>
          <span className="text-xs text-black/50">
            New draft appears in the events list immediately after cloning.
          </span>
        </div>
      </form>
    </div>
  );
}
