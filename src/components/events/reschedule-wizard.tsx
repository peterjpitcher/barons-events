"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { rescheduleEventAction, type RescheduleEventResult } from "@/actions/events";
import { normaliseEventDateTimeForStorage } from "@/lib/datetime";
import { notesClashingWithSelection, type FormNote } from "@/lib/calendar-notes/form-clash";
import { Button } from "@/components/ui/button";

type BlockedItem = { id: string; name: string; reason: string };

type RescheduleWizardProps = {
  eventId: string;
  eventTitle: string;
  venueName: string | null;
  ticketPrice: number | null;
  enabled: boolean;
  startInput: string;
  endInput: string;
  impact: {
    paidCount: number;
    freeCount: number;
    blocked: BlockedItem[];
    missingEmailCount: number;
    refundTotalPence: number;
    currency: string;
  };
  /** Venue ids of the event being rescheduled (the venue stays the same). */
  venueIds?: string[];
  /** Venue calendar notes used for the advisory clash warning near the date fields. */
  clashNotes?: FormNote[];
  /** True when calendar notes could not be loaded, so the clash check is unavailable. */
  notesUnavailable?: boolean;
};

function gbp(pence: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format(pence / 100);
}

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

export function RescheduleWizard(props: RescheduleWizardProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [startAt, setStartAt] = useState(props.startInput);
  const [endAt, setEndAt] = useState(props.endInput);
  const [result, setResult] = useState<RescheduleEventResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const hasBlocked = props.impact.blocked.length > 0;
  const totalMoving = props.impact.paidCount + props.impact.freeCount;

  // Advisory clash check against venue calendar notes for the NEW proposed
  // date. The venue set stays the same as the original event.
  const clashingNotes = useMemo(() => {
    const startIso = toClashSelectionIso(startAt);
    if (!startIso) return [];
    return notesClashingWithSelection(
      { venueIds: props.venueIds ?? [], startAt: startIso, endAt: toClashSelectionIso(endAt) },
      props.clashNotes ?? []
    );
  }, [startAt, endAt, props.venueIds, props.clashNotes]);

  function dateError(): string | null {
    if (!startAt || !endAt) return "Choose a start and end time.";
    if (new Date(endAt) <= new Date(startAt)) return "The end time must be after the start time.";
    if (new Date(startAt) <= new Date()) return "Choose a date in the future.";
    return null;
  }

  function handleSubmit() {
    startTransition(async () => {
      const res = await rescheduleEventAction({ eventId: props.eventId, newStartAt: startAt, newEndAt: endAt });
      setResult(res);
      if (res.success) {
        toast.success(`Rescheduled. ${res.movedPaidCount + res.movedFreeCount} booking(s) moved to the new date.`);
        router.replace(`/events/${res.newEventId}`);
      } else {
        toast.error(res.message);
      }
    });
  }

  if (!props.enabled) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] p-5">
        <p className="text-sm text-[var(--ink-muted)]">
          Rescheduling isn&apos;t enabled yet. Ask an administrator to turn on the reschedule wizard
          (<code>EVENT_RESCHEDULE_ENABLED</code>), or move bookings manually from the bookings page.
        </p>
        <div className="mt-4">
          <Button asChild variant="outline" size="sm">
            <Link href={`/events/${props.eventId}`}>Back to event</Link>
          </Button>
        </div>
      </div>
    );
  }

  // ---- Result view -------------------------------------------------------
  if (result?.success) {
    return (
      <div className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] p-5">
        <h2 className="text-lg font-semibold text-[var(--ink)]">Event rescheduled</h2>
        <p className="text-sm text-[var(--ink-muted)]">
          Moved <strong>{result.movedPaidCount}</strong> paid and <strong>{result.movedFreeCount}</strong> free
          booking(s) to the new date. The original event has been cancelled.
        </p>
        {result.manualContact.length > 0 ? (
          <AttentionList heading="Contact these guests directly" items={result.manualContact} />
        ) : null}
        {result.failed.length > 0 ? (
          <AttentionList heading="These could not be moved" items={result.failed} />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="primary" size="sm">
            <Link href={`/events/${result.newEventId}/bookings`}>Open the new event&apos;s bookings</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/events/${result.newEventId}`}>View the new event</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (result && !result.success && result.status === "blocked" && result.newEventId) {
    // Partial move — the clone exists but some bookings remain on the original.
    return (
      <div className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] p-5">
        <h2 className="text-lg font-semibold text-[var(--ink)]">Almost there</h2>
        <p className="text-sm text-[var(--ink-muted)]">{result.message}</p>
        {result.failed && result.failed.length > 0 ? (
          <AttentionList heading="Couldn't move" items={result.failed} />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="primary" size="sm">
            <Link href={`/events/${props.eventId}/bookings`}>Resolve remaining bookings</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/events/${result.newEventId}`}>View the new event</Link>
          </Button>
        </div>
      </div>
    );
  }

  // ---- Wizard steps ------------------------------------------------------
  return (
    <div className="space-y-5 rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] p-5">
      <ol className="flex gap-4 text-xs font-medium" aria-label="Reschedule steps">
        <li className={step === 1 ? "text-[var(--ink)]" : "text-[var(--ink-soft)]"}>1. New date &amp; time</li>
        <li className={step === 2 ? "text-[var(--ink)]" : "text-[var(--ink-soft)]"}>2. Review &amp; confirm</li>
      </ol>

      {step === 1 ? (
        <div className="space-y-4">
          <p className="text-sm text-[var(--ink-muted)]">
            Rescheduling <strong>{props.eventTitle}</strong>
            {props.venueName ? ` at ${props.venueName}` : ""}. The venue and ticket price
            {props.ticketPrice != null ? ` (${gbp(Math.round(props.ticketPrice * 100), props.impact.currency)})` : ""} stay
            the same so paid tickets move without a re-charge.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-[var(--ink)]">New start</span>
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="w-full rounded-md border border-[var(--hair)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-[var(--ink)]">New end</span>
              <input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="w-full rounded-md border border-[var(--hair)] px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          {props.notesUnavailable ? (
            <p className="mt-2 text-xs text-subtle">Clash check unavailable. Venue notes could not be loaded.</p>
          ) : clashingNotes.length > 0 ? (
            <p role="status" className="mt-2 rounded-[8px] border border-[var(--plum)] bg-[var(--plum-tint)] px-3 py-2 text-xs text-[var(--ink)]">
              {"⚠️"} Heads up: {clashingNotes.map((n) => `"${n.title}"`).join(", ")} noted at this venue on this date. You can still save.
            </p>
          ) : null}
          {dateError() ? (
            <p className="flex items-start gap-1 text-xs text-[var(--ink)]">
              <span aria-hidden="true">⚠</span>
              <span>{dateError()}</span>
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="button" variant="primary" size="sm" disabled={Boolean(dateError())} onClick={() => setStep(2)}>
              Next
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1 text-sm text-[var(--ink-muted)]">
            <p>
              <strong className="text-[var(--ink)]">{totalMoving}</strong> booking(s) will move to the new date:
            </p>
            <ul className="ml-1 space-y-1">
              <li>
                <span className="font-medium text-[var(--ink)]">{props.impact.paidCount}</span> paid (payment carried
                over — refund individually later if needed)
              </li>
              <li>
                <span className="font-medium text-[var(--ink)]">{props.impact.freeCount}</span> free
              </li>
              {props.impact.missingEmailCount > 0 ? (
                <li className="flex items-start gap-1">
                  <span aria-hidden="true">⚠</span>
                  <span>
                    <span className="font-medium text-[var(--ink)]">{props.impact.missingEmailCount}</span> have no email
                    — you&apos;ll need to contact them.
                  </span>
                </li>
              ) : null}
            </ul>
          </div>

          {hasBlocked ? (
            <div className="rounded-md border border-[var(--hair)] bg-[var(--paper-tint)] p-3 text-xs text-[var(--ink-muted)]">
              <p className="flex items-start gap-1 font-semibold text-[var(--ink)]">
                <span aria-hidden="true">⚠</span>
                <span>
                  {props.impact.blocked.length} booking(s) with pending or partial payment must be refunded first — they
                  can&apos;t be moved.
                </span>
              </p>
              <ul className="mt-1 space-y-1">
                {props.impact.blocked.map((b) => (
                  <li key={b.id}>
                    {b.name || "Guest"} — {b.reason}
                  </li>
                ))}
              </ul>
              <div className="mt-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/events/${props.eventId}/bookings`}>Resolve on the bookings page</Link>
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--ink-soft)]">
              The original event will be cancelled once every booking has moved. Refunds are done afterwards per guest.
            </p>
          )}

          <div className="flex justify-between">
            <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isPending || hasBlocked || Boolean(dateError())}
              onClick={handleSubmit}
            >
              {isPending ? "Rescheduling…" : `Reschedule & move ${totalMoving} booking(s)`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AttentionList({ heading, items }: { heading: string; items: Array<{ bookingId: string; name: string; reason: string }> }) {
  return (
    <div className="rounded-md border border-[var(--hair)] bg-[var(--paper-tint)] p-3 text-xs text-[var(--ink-muted)]">
      <p className="font-semibold text-[var(--ink)]">{heading}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item.bookingId}>
            {item.name || "Guest"} — {item.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
