"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { proposeEventAction } from "@/actions/pre-event";
import { VenueMultiSelect, type VenueOption } from "@/components/venues/venue-multi-select";
import { normaliseEventDateTimeForStorage } from "@/lib/datetime";
import { notesClashingWithSelection, type FormNote } from "@/lib/calendar-notes/form-clash";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";

type ProposeEventFormProps = {
  venues: VenueOption[];
  /**
   * Optional pre-selected venue id. When provided and matching a venue in
   * `venues`, the form opens with that venue already ticked. Used to give
   * managers a sensible default without restricting the picker.
   */
  defaultVenueId?: string | null;
  /** Venue calendar notes used for the advisory clash warning near the date field. */
  clashNotes?: FormNote[];
  /** True when calendar notes could not be loaded, so the clash check is unavailable. */
  notesUnavailable?: boolean;
};

const REQUIRED_NOTICE_DAYS = 62;

/**
 * Convert a datetime-local input value to the same ISO UTC timestamp the
 * server action stores (normaliseEventDateTimeForStorage). Returns null for
 * empty or partial input and DST-gap times, so the advisory clash check
 * stays quiet instead of throwing while the user is mid-edit.
 */
function toClashSelectionIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  try {
    return normaliseEventDateTimeForStorage(value);
  } catch {
    return null;
  }
}

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

export function ProposeEventForm({ venues, defaultVenueId, clashNotes = [], notesUnavailable = false }: ProposeEventFormProps) {
  const [state, formAction, isPending] = useActionState(proposeEventAction, undefined);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  // True once the user edits the end time themselves, after which changing the
  // start no longer overwrites their choice.
  const [endAtDirty, setEndAtDirty] = useState(false);
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

  // Mirrors the full event form: the end prefills to three hours after the
  // start and follows it until the user sets their own. Kept as wall-clock
  // arithmetic on the datetime-local string, so an event spanning a clock
  // change keeps the duration the user sees rather than the elapsed hours.
  function addThreeHours(localValue: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue);
    if (!match) return "";
    const [, year, month, day, hour, minute] = match;
    const asDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
    if (Number.isNaN(asDate.getTime())) return "";
    // Date.UTC silently rolls impossible values over (month 13 becomes January
    // of the next year), so confirm the parts survived the round trip rather
    // than returning a plausible but wrong date.
    if (
      asDate.getUTCFullYear() !== Number(year) ||
      asDate.getUTCMonth() !== Number(month) - 1 ||
      asDate.getUTCDate() !== Number(day) ||
      asDate.getUTCHours() !== Number(hour) ||
      asDate.getUTCMinutes() !== Number(minute)
    ) {
      return "";
    }
    asDate.setUTCHours(asDate.getUTCHours() + 3);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${asDate.getUTCFullYear()}-${pad(asDate.getUTCMonth() + 1)}-${pad(asDate.getUTCDate())}T${pad(asDate.getUTCHours())}:${pad(asDate.getUTCMinutes())}`;
  }

  function handleStartChange(value: string) {
    setStartAt(value);
    if (endAtDirty) return;
    setEndAt(value ? addThreeHours(value) : "");
  }

  // Both are fixed-width local datetime strings in the same timezone, so a
  // string comparison orders them correctly.
  const endBeforeStart = Boolean(startAt && endAt && endAt <= startAt);

  const shortNoticeEnteredByDate = useMemo(() => {
    if (!startAt) return null;
    const eventDate = startAt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;
    const enteredByDate = addDaysIsoDate(eventDate, -REQUIRED_NOTICE_DAYS);
    return enteredByDate < todayIsoDate() ? enteredByDate : null;
  }, [startAt]);
  // Advisory clash check against venue calendar notes. Uses the same values the
  // action normalises on submit, including the real end time so an event that
  // runs past midnight is checked against both dates.
  const clashingNotes = useMemo(() => {
    const startAtIso = toClashSelectionIso(startAt);
    if (!startAtIso) return [];
    return notesClashingWithSelection(
      { venueIds: selectedVenueIds, startAt: startAtIso, endAt: toClashSelectionIso(endAt) },
      clashNotes
    );
  }, [startAt, endAt, selectedVenueIds, clashNotes]);

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
    <form action={formAction} className="space-y-5 pb-20 md:pb-0">
      <input type="hidden" name="operation_id" value={operationIdRef.current} readOnly />
      <input type="hidden" name="idempotency_key" value={idempotencyKeyRef.current} readOnly />
      <input type="hidden" name="idempotencyKey" value={idempotencyKeyRef.current} readOnly />
      <div className="space-y-2">
        <Label htmlFor="propose-title">Event title</Label>
        <Input
          id="propose-title"
          name="title"
          required
          maxLength={200}
          placeholder="e.g. Easter Weekend Quiz"
          className="h-12 text-[16px] md:h-10 md:text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="propose-start">When is it?</Label>
        <Input
          id="propose-start"
          name="startAt"
          type="datetime-local"
          value={startAt}
          required
          className="h-12 text-[16px] md:h-10 md:text-sm"
          onChange={(event) => handleStartChange(event.target.value)}
        />
        {shortNoticeEnteredByDate ? (
          <p className="rounded-[6px] border border-[var(--mustard)] bg-[var(--mustard-tint)] px-2 py-1.5 text-xs text-[var(--mustard-dark)]" role="status">
            Short notice: this event should have been entered by {formatIsoDate(shortNoticeEnteredByDate)}.
          </p>
        ) : null}
        {notesUnavailable ? (
          <p className="mt-2 text-xs text-subtle">Clash check unavailable. Venue notes could not be loaded.</p>
        ) : clashingNotes.length > 0 ? (
          <p role="status" className="mt-2 rounded-[8px] border border-[var(--plum)] bg-[var(--plum-tint)] px-3 py-2 text-xs text-[var(--ink)]">
            {"⚠️"} Heads up: {clashingNotes.map((n) => `"${n.title}"`).join(", ")} noted at this venue on this date. You can still save.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="propose-end">When does it finish?</Label>
        <Input
          id="propose-end"
          name="endAt"
          type="datetime-local"
          value={endAt}
          required
          min={startAt || undefined}
          aria-invalid={Boolean(endBeforeStart)}
          aria-describedby="propose-end-hint"
          className="h-12 text-[16px] md:h-10 md:text-sm"
          onChange={(event) => {
            setEndAtDirty(true);
            setEndAt(event.target.value);
          }}
        />
        <p id="propose-end-hint" className="text-xs text-subtle">
          {endBeforeStart
            ? "The end time must be after the start time."
            : "Filled in for you as three hours after the start. Change it if that is wrong."}
        </p>
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
          className="text-[16px] md:text-sm"
        />
      </div>

      <SubmitButton
        label="Submit proposal"
        pendingLabel="Submitting..."
        variant="primary"
        disabled={isPending}
        className="hidden md:inline-flex"
      />
      <div className="mobile-actionbar md:hidden">
        <SubmitButton
          label="Submit proposal"
          pendingLabel="Submitting..."
          variant="primary"
          disabled={isPending || selectedVenueIds.length === 0}
          className="h-12 flex-1"
        />
      </div>
    </form>
  );
}
