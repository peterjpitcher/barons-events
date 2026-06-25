"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  cancelEventAction,
  getEventCancellationPreviewAction,
  updateEventStatusAction,
  type CancellationAttentionItem,
  type EventCancellationPreview,
} from "@/actions/events";
import { Button } from "@/components/ui/button";

type CancelEventDialogProps = {
  eventId: string;
  eventTitle: string;
  onChanged?: () => void;
};

function formatGbp(amountPence: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountPence / 100);
}

/**
 * Cancel-event control that resolves bookings safely. On open it loads a preview
 * (how many bookings are paid/free/blocked and the total to refund) so the admin
 * sees the consequences before confirming. Confirming runs the cancellation
 * cascade; bookings that block cancellation or need manual contact are listed.
 */
export function CancelEventDialog({ eventId, eventTitle, onChanged }: CancelEventDialogProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<EventCancellationPreview | null>(null);
  const [reason, setReason] = useState("");
  const [attention, setAttention] = useState<{ heading: string; items: CancellationAttentionItem[] } | null>(null);
  const [loadingPreview, startLoadPreview] = useTransition();
  const [isPending, startTransition] = useTransition();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleOpen() {
    setOpen(true);
    setPreview(null);
    setReason("");
    setAttention(null);
    startLoadPreview(async () => {
      const result = await getEventCancellationPreviewAction(eventId);
      setPreview(result);
    });
  }

  function handleConfirm() {
    if (!preview || !preview.success) return;
    const trimmedReason = reason.trim() || null;
    setAttention(null);
    startTransition(async () => {
      if (preview.enabled) {
        const result = await cancelEventAction({ eventId, reason: trimmedReason });
        if (result.success) {
          onChanged?.();
          if (result.manualContact && result.manualContact.length > 0) {
            toast.warning(result.message ?? "Event cancelled — some guests need manual contact.");
            setAttention({ heading: "Guests to contact manually", items: result.manualContact });
          } else {
            toast.success(result.message ?? "Event cancelled.");
            setOpen(false);
          }
        } else {
          toast.error(result.message ?? "Could not cancel the event.");
          if (result.blocked && result.blocked.length > 0) {
            setAttention({ heading: "Resolve these bookings first", items: result.blocked });
          }
        }
      } else {
        // Cascade disabled: only safe when there are no confirmed bookings.
        const result = await updateEventStatusAction({ eventId, status: "cancelled" });
        if (result.success) {
          toast.success(result.message ?? "Event cancelled.");
          setOpen(false);
          onChanged?.();
        } else {
          toast.error(result.message ?? "Could not cancel the event.");
        }
      }
    });
  }

  const canConfirm = (() => {
    if (!preview || !preview.success || isPending || loadingPreview) return false;
    if (preview.enabled) return preview.blockedCount === 0;
    return preview.confirmedBookings === 0;
  })();

  const confirmLabel = (() => {
    if (!preview || !preview.success) return "Cancel event";
    if (preview.enabled && preview.refundTotalPence > 0) {
      return `Cancel event and refund ${formatGbp(preview.refundTotalPence, preview.currency)}`;
    }
    return "Cancel event";
  })();

  return (
    <>
      <Button type="button" variant="destructive" size="sm" className="shrink-0" onClick={handleOpen}>
        Cancel event
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] p-5 shadow-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id={titleId} className="text-lg font-semibold text-[var(--ink)]">
              Cancel {eventTitle}?
            </h2>

            {loadingPreview || preview === null ? (
              <p className="mt-3 text-sm text-[var(--ink-muted)]">Checking bookings…</p>
            ) : !preview.success ? (
              <p className="mt-3 text-sm text-[var(--ink-muted)]">{preview.message}</p>
            ) : (
              <div className="mt-3 space-y-2 text-sm text-[var(--ink-muted)]">
                {preview.confirmedBookings === 0 ? (
                  <p>This event has no confirmed bookings.</p>
                ) : (
                  <ul className="space-y-1">
                    <li>
                      <span className="font-medium text-[var(--ink)]">{preview.confirmedBookings}</span> confirmed
                      booking{preview.confirmedBookings === 1 ? "" : "s"}.
                    </li>
                    {preview.paidRefundableCount > 0 ? (
                      <li>
                        <span className="font-medium text-[var(--ink)]">{preview.paidRefundableCount}</span> paid — will
                        be refunded{" "}
                        <span className="font-medium text-[var(--ink)]">
                          {formatGbp(preview.refundTotalPence, preview.currency)}
                        </span>
                        .
                      </li>
                    ) : null}
                    {preview.unpaidFreeCount > 0 ? (
                      <li>
                        <span className="font-medium text-[var(--ink)]">{preview.unpaidFreeCount}</span> free — will be
                        cancelled and emailed.
                      </li>
                    ) : null}
                    {preview.missingEmailCount > 0 ? (
                      <li className="flex items-start gap-1">
                        <span aria-hidden="true">⚠</span>
                        <span>
                          <span className="font-medium text-[var(--ink)]">{preview.missingEmailCount}</span> have no email
                          — you will need to contact them.
                        </span>
                      </li>
                    ) : null}
                    {preview.blockedCount > 0 ? (
                      <li className="flex items-start gap-1">
                        <span aria-hidden="true">⚠</span>
                        <span>
                          <span className="font-medium text-[var(--ink)]">{preview.blockedCount}</span> have pending or
                          partial payment — refund or transfer them first.
                        </span>
                      </li>
                    ) : null}
                  </ul>
                )}

                {!preview.enabled && preview.confirmedBookings > 0 ? (
                  <p className="flex items-start gap-1 font-medium text-[var(--ink)]">
                    <span aria-hidden="true">⚠</span>
                    <span>
                      The cancellation flow is disabled. Refund or transfer the booking(s) first, then cancel.
                    </span>
                  </p>
                ) : null}

                {preview.enabled && preview.refundTotalPence > 0 ? (
                  <p className="text-xs text-[var(--ink-soft)]">
                    Refunds return to each guest&apos;s original payment method and cannot be undone.
                  </p>
                ) : null}

                <label className="sr-only" htmlFor={`cancel-reason-${eventId}`}>
                  Reason (optional)
                </label>
                <input
                  id={`cancel-reason-${eventId}`}
                  type="text"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Reason (optional, shown to guests)"
                  className="w-full rounded-md border border-[var(--hair)] px-2 py-1 text-sm"
                />
              </div>
            )}

            {attention ? (
              <div className="mt-3 rounded-md border border-[var(--hair)] bg-[var(--paper-tint)] p-3 text-xs text-[var(--ink-muted)]">
                <p className="font-semibold text-[var(--ink)]">{attention.heading}</p>
                <ul className="mt-1 space-y-1">
                  {attention.items.map((item) => (
                    <li key={item.bookingId}>
                      {item.name || "Guest"} — {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <Button ref={closeRef} type="button" variant="outline" disabled={isPending} onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button type="button" variant="destructive" disabled={!canConfirm} onClick={handleConfirm}>
                {isPending ? "Cancelling…" : confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
