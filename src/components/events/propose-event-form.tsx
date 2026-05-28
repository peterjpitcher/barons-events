"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { proposeEventAction } from "@/actions/pre-event";
import { VenueMultiSelect, type VenueOption } from "@/components/venues/venue-multi-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";

type ProposeEventFormProps = {
  venues: VenueOption[];
  /**
   * Optional pre-selected venue id. When provided and matching a venue in
   * `venues`, the form opens with that venue already ticked. Used to give
   * office workers a sensible default without restricting the picker.
   */
  defaultVenueId?: string | null;
};

const REQUIRED_NOTICE_DAYS = 62;

function todayIsoDate(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysIsoDate(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatIsoDate(dateString: string): string {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function ProposeEventForm({ venues, defaultVenueId }: ProposeEventFormProps) {
  const [state, formAction, isPending] = useActionState(proposeEventAction, undefined);
  const [startAt, setStartAt] = useState("");
  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>(() => {
    if (defaultVenueId && venues.some((v) => v.id === defaultVenueId)) {
      return [defaultVenueId];
    }
    return venues.length === 1 ? [venues[0].id] : [];
  });
  // SEC-004 v3.2: stable idempotency key generated once per form mount.
  // The RPC uses it to deduplicate double-submits (same key -> same result).
  // A fresh form render gets a fresh key, so legitimate re-proposals work.
  const operationIdRef = useRef(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "00000000-0000-4000-8000-000000000002"
  );
  const idempotencyKeyRef = useRef(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "00000000-0000-4000-8000-000000000003"
  );
  const router = useRouter();
  const shortNoticeEnteredByDate = useMemo(() => {
    if (!startAt) return null;
    const eventDate = startAt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;
    const enteredByDate = addDaysIsoDate(eventDate, -REQUIRED_NOTICE_DAYS);
    return enteredByDate < todayIsoDate() ? enteredByDate : null;
  }, [startAt]);

  useEffect(() => {
    if (state?.message) {
      if (state.success) {
        toast.success(state.message);
        router.push("/events");
      } else {
        toast.error(
          state.operationId
            ? `${state.message} (ref: ${state.operationId.slice(0, 8)})`
            : state.message
        );
      }
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="operation_id" value={operationIdRef.current} readOnly />
      <input type="hidden" name="idempotency_key" value={idempotencyKeyRef.current} readOnly />
      <input type="hidden" name="idempotencyKey" value={idempotencyKeyRef.current} readOnly />
      <div className="space-y-2">
        <Label htmlFor="propose-title">Event title</Label>
        <Input id="propose-title" name="title" required maxLength={200} placeholder="e.g. Easter Weekend Quiz" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="propose-start">When is it?</Label>
        <Input
          id="propose-start"
          name="startAt"
          type="datetime-local"
          value={startAt}
          required
          onChange={(event) => setStartAt(event.target.value)}
        />
        {shortNoticeEnteredByDate ? (
          <p className="rounded-[6px] border border-[var(--mustard)] bg-[var(--mustard-tint)] px-2 py-1.5 text-xs text-[var(--mustard-dark)]" role="status">
            Short notice: this event should have been entered by {formatIsoDate(shortNoticeEnteredByDate)}.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium text-[var(--ink)]">Which venues?</span>
        <VenueMultiSelect
          venues={venues}
          selectedIds={selectedVenueIds}
          onChange={setSelectedVenueIds}
          hiddenFieldName="venueIds"
          allowEmpty={false}
          placeholder="Choose venues"
        />
        {selectedVenueIds.length === 0 ? (
          <p className="text-xs text-[var(--burgundy)]">Pick at least one venue.</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="propose-notes">Short description</Label>
        <Textarea
          id="propose-notes"
          name="notes"
          rows={4}
          required
          maxLength={2000}
          placeholder="A sentence or two about the idea — the admin will use this to decide whether to green-light it."
        />
      </div>

      <SubmitButton
        label="Submit proposal"
        pendingLabel="Submitting..."
        variant="primary"
        disabled={isPending}
      />
    </form>
  );
}
