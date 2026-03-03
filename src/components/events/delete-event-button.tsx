"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteEventAction } from "@/actions/events";

type DeleteEventButtonProps = {
  eventId: string;
  variant?: "form" | "button";
};

export function DeleteEventButton({ eventId, variant = "form" }: DeleteEventButtonProps) {
  const [state, formAction, isPending] = useActionState(deleteEventAction, undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const proxyRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state?.message && !state.success) {
      toast.error(state.message);
    }
  }, [state]);

  function handleConfirm() {
    setConfirmOpen(false);
    if (variant === "button") {
      proxyRef.current?.click();
    } else {
      formRef.current?.requestSubmit();
    }
  }

  const dialog = (
    <ConfirmDialog
      open={confirmOpen}
      title="Delete this event?"
      description="This action cannot be undone."
      confirmLabel="Delete"
      variant="danger"
      onConfirm={handleConfirm}
      onCancel={() => setConfirmOpen(false)}
    />
  );

  if (variant === "button") {
    return (
      <>
        <input type="hidden" name="eventId" value={eventId} />
        <button ref={proxyRef} type="submit" formAction={formAction} className="sr-only" aria-hidden tabIndex={-1} />
        <Button type="button" variant="destructive" disabled={isPending} onClick={() => setConfirmOpen(true)}>
          <Trash2Icon className="mr-2 h-4 w-4" />
          {isPending ? "Deleting..." : "Delete event"}
        </Button>
        {dialog}
      </>
    );
  }

  return (
    <>
      <form ref={formRef} action={formAction}>
        <input type="hidden" name="eventId" value={eventId} />
        <Button type="button" variant="destructive" disabled={isPending} onClick={() => setConfirmOpen(true)}>
          <Trash2Icon className="mr-2 h-4 w-4" />
          {isPending ? "Deleting..." : "Delete event"}
        </Button>
      </form>
      {dialog}
    </>
  );
}
