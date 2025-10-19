"use client";

import { useActionState, useMemo } from "react";
import { cloneEventAction, type CloneEventState } from "@/actions/events";
import type { EventSummary } from "@/lib/events/analytics";
import { Button } from "@/components/ui/button";

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

  const [state, dispatch] = useActionState<CloneEventState, FormData>(
    async (_, formData) => (await cloneEventAction(formData)) ?? initialState,
    initialState
  );

  return (
    <div className="space-y-4 rounded-xl border border-[rgba(42,79,168,0.18)] bg-white/95 p-6 shadow-soft">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-[var(--color-primary-900)]">Start from an existing event</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Create a new draft using the latest details from a past event. Update the schedule and specifics before you send it for review.
        </p>
      </header>

      <form action={dispatch} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="eventId" className="text-sm font-medium text-[var(--color-text)]">
            Choose an event to copy
          </label>
          <select
            id="eventId"
            name="eventId"
            defaultValue=""
            className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
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
          <div className="rounded-md bg-[rgba(239,68,68,0.12)] px-3 py-2 text-sm text-[var(--color-danger)]">
            {state.error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" size="sm">
            Copy event
          </Button>
          <span className="text-xs text-[var(--color-text-subtle)]">
            The new draft appears in the events list right away.
          </span>
        </div>
      </form>
    </div>
  );
}
