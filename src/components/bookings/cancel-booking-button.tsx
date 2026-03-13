"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cancelBookingAction } from "@/actions/bookings";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type CancelBookingButtonProps = {
  bookingId: string;
  eventId: string;
  guestName: string;
};

export function CancelBookingButton({ bookingId, eventId, guestName }: CancelBookingButtonProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleConfirm() {
    setConfirmOpen(false);
    startTransition(async () => {
      const result = await cancelBookingAction(bookingId, eventId);
      if (result.success) {
        toast.success("Booking cancelled.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Could not cancel booking. Please try again.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={isPending}
        onClick={() => setConfirmOpen(true)}
      >
        {isPending ? "Cancelling…" : "Cancel"}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title={`Cancel booking for ${guestName}?`}
        description="This will mark the booking as cancelled. The guest will not be automatically notified."
        confirmLabel="Cancel booking"
        variant="danger"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
