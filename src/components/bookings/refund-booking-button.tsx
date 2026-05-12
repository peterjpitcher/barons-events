"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { refundBookingAction } from "@/actions/bookings";
import { Button } from "@/components/ui/button";

type RefundBookingButtonProps = {
  transactionId: string;
  eventId: string;
  refundableAmountPence: number;
  currency: string;
};

function formatAmount(amountPence: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountPence / 100);
}

export function RefundBookingButton({
  transactionId,
  eventId,
  refundableAmountPence,
  currency,
}: RefundBookingButtonProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleRefund() {
    const trimmed = amount.trim();
    const amountPence = trimmed ? Math.round(Number(trimmed) * 100) : null;
    if (amountPence !== null && (!Number.isInteger(amountPence) || amountPence <= 0 || amountPence > refundableAmountPence)) {
      toast.error("Enter a valid partial amount or leave blank for a full refund.");
      return;
    }

    startTransition(async () => {
      const result = await refundBookingAction({
        transactionId,
        eventId,
        amountPence,
        reason: reason.trim() || null,
      });
      if (result.success) {
        toast.success(`Refunded ${formatAmount(result.amountPence, currency)}.`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending || refundableAmountPence <= 0}
        onClick={() => setOpen(true)}
      >
        Refund
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-3 text-left shadow-soft">
      <p className="text-xs font-semibold text-[var(--color-text)]">
        Refund up to {formatAmount(refundableAmountPence, currency)}
      </p>
      <input
        type="number"
        min="0.01"
        step="0.01"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="Full refund"
        className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-xs"
      />
      <input
        type="text"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Reason (optional)"
        className="w-full rounded-md border border-[var(--color-border)] px-2 py-1 text-xs"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setOpen(false)}>
          Close
        </Button>
        <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={handleRefund}>
          {isPending ? "Refunding..." : "Confirm"}
        </Button>
      </div>
    </div>
  );
}
