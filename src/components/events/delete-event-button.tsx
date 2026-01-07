"use client";

import { useActionState, useEffect, type FormEvent } from "react";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteEventAction } from "@/actions/events";

export function DeleteEventButton({ eventId }: { eventId: string }) {
  const [state, formAction, isPending] = useActionState(deleteEventAction, undefined);

  useEffect(() => {
    if (state?.message && !state.success) {
      toast.error(state.message);
    }
  }, [state]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm("Are you sure you want to delete this event? This action cannot be undone.");
    if (!confirmed) {
      event.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit}>
      <input type="hidden" name="eventId" value={eventId} />
      <Button type="submit" variant="destructive" disabled={isPending}>
        <Trash2Icon className="mr-2 h-4 w-4" />
        {isPending ? "Deleting..." : "Delete event"}
      </Button>
    </form>
  );
}
