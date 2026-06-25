"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { transferBookingAction, listTransferTargetsAction } from "@/actions/bookings";
import type { TransferTarget } from "@/lib/bookings";
import { Button } from "@/components/ui/button";

type TransferBookingButtonProps = {
  bookingId: string;
  guestName: string;
};

const targetDateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Europe/London",
});

/**
 * Transfer a fully-paid booking to another equal-price event. Eligible target
 * events are loaded lazily when the panel opens (admin-only server action). The
 * customer's existing payment is carried over — no refund or re-charge.
 */
export function TransferBookingButton({ bookingId, guestName }: TransferBookingButtonProps) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<TransferTarget[] | null>(null);
  const [selected, setSelected] = useState("");
  const [reason, setReason] = useState("");
  const [loadingTargets, startLoadTargets] = useTransition();
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleOpen() {
    setOpen(true);
    setTargets(null);
    setSelected("");
    setReason("");
    startLoadTargets(async () => {
      const result = await listTransferTargetsAction(bookingId);
      if (result.success) {
        setTargets(result.targets);
      } else {
        toast.error(result.error);
        setTargets([]);
      }
    });
  }

  function handleTransfer() {
    if (!selected) {
      toast.error("Choose an event to transfer this booking to.");
      return;
    }
    startTransition(async () => {
      const result = await transferBookingAction({
        sourceBookingId: bookingId,
        targetEventId: selected,
        reason: reason.trim() || null,
      });
      if (result.success) {
        if (result.manualContactRequired) {
          toast.warning(
            "Booking transferred — please contact the guest directly (no email on file or the email could not be sent)."
          );
        } else {
          toast.success("Booking transferred and the guest has been emailed.");
        }
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={handleOpen}>
        Transfer
      </Button>
    );
  }

  const selectedTarget = targets?.find((target) => target.eventId === selected) ?? null;

  return (
    <div className="space-y-2 rounded-[var(--radius)] border border-[var(--hair)] bg-[var(--paper)] p-3 text-left shadow-card">
      <p className="text-xs font-semibold text-[var(--ink)]">Transfer {guestName}&apos;s booking</p>
      {loadingTargets || targets === null ? (
        <p className="text-xs text-subtle">Loading eligible events…</p>
      ) : targets.length === 0 ? (
        <p className="text-xs text-subtle">
          No eligible events. Create the rescheduled event at the same ticket price and approve it first.
        </p>
      ) : (
        <>
          <label className="sr-only" htmlFor={`transfer-target-${bookingId}`}>
            Choose a new event
          </label>
          <select
            id={`transfer-target-${bookingId}`}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className="w-full rounded-md border border-[var(--hair)] px-2 py-1 text-xs"
          >
            <option value="">Select a new event…</option>
            {targets.map((target) => (
              <option key={target.eventId} value={target.eventId}>
                {target.title} — {targetDateFormatter.format(new Date(target.startAt))}
                {target.venueName ? ` · ${target.venueName}` : ""}
                {target.remainingCapacity !== null ? ` (${target.remainingCapacity} left)` : ""}
              </option>
            ))}
          </select>
          {selectedTarget?.venueMismatch ? (
            <p className="flex items-start gap-1 text-xs font-medium text-[var(--ink)]">
              <span aria-hidden="true">⚠</span>
              <span>
                This moves the booking to a different venue
                {selectedTarget.venueName ? ` (${selectedTarget.venueName})` : ""}.
              </span>
            </p>
          ) : null}
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason (optional)"
            className="w-full rounded-md border border-[var(--hair)] px-2 py-1 text-xs"
          />
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setOpen(false)}>
          Close
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={isPending || loadingTargets || !selected}
          onClick={handleTransfer}
        >
          {isPending ? "Transferring…" : "Transfer booking"}
        </Button>
      </div>
    </div>
  );
}
