"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { revertToDraftAction } from "@/actions/events";

type RevertToDraftButtonProps = {
  eventId: string;
};

export function RevertToDraftButton({ eventId }: RevertToDraftButtonProps) {
  const [state, formAction, isPending] = useActionState(revertToDraftAction, undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) {
      toast.success(state.message ?? "Event reverted to draft.");
    } else if (state?.message && !state.success) {
      toast.error(state.message);
    }
  }, [state]);

  function handleConfirm() {
    setConfirmOpen(false);
    formRef.current?.requestSubmit();
  }

  return (
    <>
      <form ref={formRef} action={formAction}>
        <input type="hidden" name="eventId" value={eventId} />
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={() => setConfirmOpen(true)}
        >
          <RotateCcwIcon className="mr-2 h-4 w-4" />
          {isPending ? "Reverting..." : "Revert to draft"}
        </Button>
      </form>
      <ConfirmDialog
        open={confirmOpen}
        title="Revert event to draft?"
        description="This will set the event back to draft, clear the assignee, and remove it from the approved schedule. You can re-approve it at any time."
        confirmLabel="Revert to draft"
        variant="danger"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
