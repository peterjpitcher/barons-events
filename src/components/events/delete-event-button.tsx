"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type DeleteEventButtonProps = {
  eventId: string;
};

async function deleteEvent(eventId: string): Promise<{ success: boolean; message?: string }> {
  const formData = new FormData();
  formData.append("eventId", eventId);

  const { deleteEventAction } = await import("@/actions/events");
  return deleteEventAction(undefined, formData);
}

export function DeleteEventButton({ eventId }: DeleteEventButtonProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleConfirm() {
    setConfirmOpen(false);
    startTransition(async () => {
      try {
        const result = await deleteEvent(eventId);
        if (result?.success) {
          toast.success(result.message ?? "Event deleted.");
          router.push("/events");
          router.refresh();
        } else {
          toast.error(result?.message ?? "Could not delete the event.");
        }
      } catch {
        // redirect() throws a NEXT_REDIRECT error — this is expected
        router.push("/events");
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        disabled={isPending}
        onClick={() => setConfirmOpen(true)}
      >
        <Trash2Icon className="mr-2 h-4 w-4" />
        {isPending ? "Deleting..." : "Delete event"}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this event?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
