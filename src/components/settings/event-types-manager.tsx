"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { createEventTypeAction, updateEventTypeAction, deleteEventTypeAction } from "@/actions/event-types";
import type { EventTypeRow } from "@/lib/event-types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";

type ManagerProps = {
  eventTypes: EventTypeRow[];
};

export function EventTypesManager({ eventTypes }: ManagerProps) {
  return (
    <div className="space-y-6">
      <CreateEventTypeForm />
      <div className="grid gap-4 md:grid-cols-2">
        {eventTypes.map((type) => (
          <EventTypeCard key={type.id} type={type} />
        ))}
        {eventTypes.length === 0 ? (
          <Card className="md:col-span-2">
            <CardContent className="py-8 text-center text-subtle">No event types yet. Add the first one above.</CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function CreateEventTypeForm() {
  const [state, formAction] = useActionState(createEventTypeAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      formRef.current?.reset();
    } else {
      toast.error(state.message);
    }
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add an event type</CardTitle>
        <CardDescription>Keep the picklist current so venues choose consistent labels.</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={formAction} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-2">
            <Label htmlFor="new-event-type">Event type name</Label>
            <Input id="new-event-type" name="label" placeholder="Tap Takeover" required />
            <p className="text-xs text-subtle">Make it short and specific (e.g., Quiz, Charity Night).</p>
          </div>
          <div className="flex items-end">
            <SubmitButton label="Add type" pendingLabel="Saving..." />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function EventTypeCard({ type }: { type: EventTypeRow }) {
  const [updateState, updateAction] = useActionState(updateEventTypeAction, undefined);
  const [deleteState, deleteAction] = useActionState(deleteEventTypeAction, undefined);

  useEffect(() => {
    if (updateState?.message) {
      if (updateState.success) {
        toast.success(updateState.message);
      } else {
        toast.error(updateState.message);
      }
    }
  }, [updateState]);

  useEffect(() => {
    if (deleteState?.message) {
      if (deleteState.success) {
        toast.success(deleteState.message);
      } else {
        toast.error(deleteState.message);
      }
    }
  }, [deleteState]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg text-[var(--color-primary-700)]">{type.label}</CardTitle>
        <CardDescription>Last updated {new Date(type.created_at).toLocaleDateString("en-GB")}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form action={updateAction} className="space-y-3">
          <input type="hidden" name="typeId" value={type.id} />
          <div className="space-y-2">
            <Label htmlFor={`event-type-${type.id}`}>Event type name</Label>
            <Input id={`event-type-${type.id}`} name="label" defaultValue={type.label} required />
          </div>
          <SubmitButton label="Save" pendingLabel="Saving..." />
        </form>
        <form action={deleteAction} className="inline-flex">
          <input type="hidden" name="typeId" value={type.id} />
          <SubmitButton label="Remove" pendingLabel="Removing..." variant="destructive" />
        </form>
      </CardContent>
    </Card>
  );
}
